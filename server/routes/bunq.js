/**
 * bunq API Proxy
 *
 * Auth flow: Installation → DeviceServer → SessionServer → session token
 * The session token is stored in BUNQ_SESSION_TOKEN env var (refreshed via
 * the /api/bunq/session/refresh endpoint when it expires, ~1 week TTL).
 *
 * Docs: https://doc.bunq.com/
 */

import { Router } from 'express'
import { createSign } from 'node:crypto'
import { readFileSync } from 'node:fs'

export const bunqRouter = Router()

const BASE          = process.env.BUNQ_API_BASE      || 'https://public-api.sandbox.bunq.com/v1'
const API_KEY       = process.env.BUNQ_API_KEY       || ''
const SESSION_TOKEN = process.env.BUNQ_SESSION_TOKEN || ''

// Load the private key written during session setup (used to sign mutating requests)
let PRIVATE_KEY = null
try {
  const keyPath = process.env.BUNQ_PRIVATE_KEY_PATH || '/tmp/bunq_keys.json'
  PRIVATE_KEY = JSON.parse(readFileSync(keyPath, 'utf8')).privateKey
} catch { /* no key file — signing disabled, sandbox read-only ops will still work */ }

function isMocked() {
  return !API_KEY || API_KEY.startsWith('your_') || API_KEY.startsWith('REPLACE_')
}

function signBody(body) {
  if (!PRIVATE_KEY || !body) return null
  const sign = createSign('SHA256')
  sign.update(body)
  return sign.sign(PRIVATE_KEY, 'base64')
}

function bunqHeaders(token, bodyStr) {
  const h = {
    'Content-Type':              'application/json',
    'Cache-Control':             'no-cache',
    'X-Bunq-Client-Request-Id':  crypto.randomUUID(),
    'X-Bunq-Geolocation':        '0 0 0 0 NL',
    'X-Bunq-Language':           'en_US',
    'X-Bunq-Region':             'en_US',
    'X-Bunq-Client-Authentication': token || SESSION_TOKEN,
  }
  if (bodyStr) {
    const sig = signBody(bodyStr)
    if (sig) h['X-Bunq-Client-Signature'] = sig
  }
  return h
}

// Per-request token: frontend can pass X-Bunq-Token for OAuth user tokens,
// otherwise falls back to the server session token.
function resolveToken(req) {
  return req.headers['x-bunq-token'] || SESSION_TOKEN
}

async function bunqProxy(method, path, body, token) {
  if (isMocked()) {
    await new Promise(r => setTimeout(r, 300 + Math.random() * 200))
    return {
      Response: [{ Id: { id: Math.floor(Math.random() * 100000) } }],
      _mock: true,
    }
  }

  const bodyStr = body ? JSON.stringify(body) : undefined
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: bunqHeaders(token, bodyStr),
    ...(bodyStr ? { body: bodyStr } : {}),
    signal: AbortSignal.timeout(15_000),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw Object.assign(new Error(`bunq API ${res.status}: ${text.slice(0, 200)}`), { status: 502 })
  }

  return res.json()
}

// ── Session management ────────────────────────────────────────

/**
 * POST /api/bunq/session/refresh
 * Re-runs Installation→DeviceServer→SessionServer and returns a new session token.
 * Call this when you get 401/403 from other endpoints.
 */
bunqRouter.post('/session/refresh', async (req, res, next) => {
  try {
    if (isMocked()) return res.json({ ok: true, mock: true })

    const { generateKeyPairSync } = await import('node:crypto')
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding:  { type: 'pkcs1', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    })

    const baseHeaders = {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Bunq-Client-Request-Id': crypto.randomUUID(),
      'X-Bunq-Geolocation': '0 0 0 0 NL',
      'X-Bunq-Language': 'en_US',
      'X-Bunq-Region': 'en_US',
    }

    // Install
    const installRes = await fetch(`${BASE}/installation`, {
      method: 'POST', headers: baseHeaders,
      body: JSON.stringify({ client_public_key: publicKey }),
    })
    const installData = await installRes.json()
    if (!installRes.ok) throw Object.assign(new Error('Installation failed'), { status: 502 })
    const installToken = installData.Response.find(r => r.Token)?.Token?.token

    const authedHeaders = { ...baseHeaders, 'X-Bunq-Client-Authentication': installToken }

    // Device
    const deviceRes = await fetch(`${BASE}/device-server`, {
      method: 'POST', headers: { ...authedHeaders, 'X-Bunq-Client-Request-Id': crypto.randomUUID() },
      body: JSON.stringify({ description: 'bunq-aether', secret: API_KEY, permitted_ips: ['*'] }),
    })
    if (!deviceRes.ok) throw Object.assign(new Error('Device registration failed'), { status: 502 })

    // Session
    const sessionRes = await fetch(`${BASE}/session-server`, {
      method: 'POST', headers: { ...authedHeaders, 'X-Bunq-Client-Request-Id': crypto.randomUUID() },
      body: JSON.stringify({ secret: API_KEY }),
    })
    const sessionData = await sessionRes.json()
    if (!sessionRes.ok) throw Object.assign(new Error('Session creation failed'), { status: 502 })

    const sessionToken = sessionData.Response.find(r => r.Token)?.Token?.token
    const userId = sessionData.Response.find(r => r.UserPerson || r.UserCompany)
      ?.[Object.keys(sessionData.Response.find(r => r.UserPerson || r.UserCompany))[0]]?.id

    res.json({ ok: true, sessionToken, userId,
      message: 'Update BUNQ_SESSION_TOKEN and BUNQ_USER_ID in .env and restart the server.' })
  } catch (err) { next(err) }
})

// ── Accounts ──────────────────────────────────────────────────
bunqRouter.get('/accounts/:userId', async (req, res, next) => {
  try {
    const data = await bunqProxy('GET', `/user/${req.params.userId}/monetary-account`, null, resolveToken(req))
    res.json(data)
  } catch (err) { next(err) }
})

// ── Cards ─────────────────────────────────────────────────────
bunqRouter.get('/cards/:userId', async (req, res, next) => {
  try {
    const data = await bunqProxy('GET', `/user/${req.params.userId}/card`, null, resolveToken(req))
    res.json(data)
  } catch (err) { next(err) }
})

bunqRouter.put('/cards/:userId/:cardId/block', async (req, res, next) => {
  try {
    // bunq uses FROZEN to temporarily block a card (BLOCKED is a permanent status)
    const data = await bunqProxy('PUT', `/user/${req.params.userId}/card/${req.params.cardId}`,
      { status: 'FROZEN' }, resolveToken(req))
    res.json(data)
  } catch (err) { next(err) }
})

bunqRouter.put('/cards/:userId/:cardId/unblock', async (req, res, next) => {
  try {
    const data = await bunqProxy('PUT', `/user/${req.params.userId}/card/${req.params.cardId}`,
      { status: 'ACTIVE' }, resolveToken(req))
    res.json(data)
  } catch (err) { next(err) }
})

// ── Payments ──────────────────────────────────────────────────
bunqRouter.post('/payments/:userId/:accountId/transfer', async (req, res, next) => {
  try {
    const { toIban, amount, description } = req.body
    const data = await bunqProxy(
      'POST',
      `/user/${req.params.userId}/monetary-account/${req.params.accountId}/payment`,
      {
        amount:             { value: Number(amount).toFixed(2), currency: 'EUR' },
        counterparty_alias: { type: 'IBAN', value: toIban, name: 'Aether Transfer' },
        description:        description || 'Aether Transfer',
      },
      resolveToken(req)
    )
    res.json(data)
  } catch (err) { next(err) }
})

// ── Payment requests (split) ───────────────────────────────────
bunqRouter.post('/requests/:userId/:accountId/send', async (req, res, next) => {
  try {
    const { contactAlias, amount, description } = req.body
    const data = await bunqProxy(
      'POST',
      `/user/${req.params.userId}/monetary-account/${req.params.accountId}/request-inquiry`,
      {
        amount_inquired:    { value: Number(amount).toFixed(2), currency: 'EUR' },
        counterparty_alias: { type: 'EMAIL', value: contactAlias },
        description:        description || 'Aether Split',
        allow_bunqme:       true,
      },
      resolveToken(req)
    )
    res.json(data)
  } catch (err) { next(err) }
})

// ── Transactions ──────────────────────────────────────────────
bunqRouter.get('/transactions/:userId/:accountId', async (req, res, next) => {
  try {
    const count = req.query.count || 50
    const data  = await bunqProxy('GET',
      `/user/${req.params.userId}/monetary-account/${req.params.accountId}/payment?count=${count}`,
      null, resolveToken(req))
    res.json(data)
  } catch (err) { next(err) }
})

// ── OAuth token exchange (called after redirect) ──────────────
bunqRouter.post('/oauth/token', async (req, res, next) => {
  try {
    const { code, redirectUri } = req.body
    if (!code) return res.status(400).json({ error: 'code is required' })

    const params = new URLSearchParams({
      grant_type:    'authorization_code',
      code,
      redirect_uri:  redirectUri || process.env.BUNQ_REDIRECT_URI,
      client_id:     process.env.BUNQ_OAUTH_CLIENT_ID,
      client_secret: process.env.BUNQ_OAUTH_CLIENT_SECRET,
    })

    const tokenRes = await fetch('https://api.oauth.bunq.com/v1/token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    params.toString(),
      signal:  AbortSignal.timeout(10_000),
    })

    const data = await tokenRes.json()
    if (!tokenRes.ok) return res.status(502).json({ error: 'bunq OAuth failed', detail: data })

    res.json({ access_token: data.access_token, token_type: data.token_type })
  } catch (err) { next(err) }
})
