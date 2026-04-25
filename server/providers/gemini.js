/**
 * Gemini provider — Google Generative Language API
 * Model: gemini-2.0-flash-lite  (cheapest Gemini model with vision support)
 * Docs: https://ai.google.dev/api/generate-content
 *
 * Pricing (as of 2025): ~$0.075 per 1M input tokens (very cheap)
 */

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models'
const MODEL      = 'gemini-2.5-flash-lite'

export async function callGemini({ systemPrompt, userMessage, imageBase64, priorTurns = [] }) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey || apiKey.startsWith('AIza_REPLACE')) {
    throw Object.assign(new Error('Gemini API key not configured'), { status: 503 })
  }

  // Replay earlier turns. Gemini uses role='user' and role='model'.
  // Strip images from prior turns — they're not needed for context continuity.
  const contents = []
  for (const turn of priorTurns) {
    const userText = (turn.voice_text || '').trim()
    const reply    = (turn.voice_response || '').trim()
    if (userText) contents.push({ role: 'user',  parts: [{ text: userText }] })
    if (reply)    contents.push({ role: 'model', parts: [{ text: reply }] })
  }

  const parts = []
  if (imageBase64) {
    parts.push({
      inlineData: { mimeType: 'image/jpeg', data: imageBase64 },
    })
  }
  parts.push({ text: userMessage })
  contents.push({ role: 'user', parts })

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: {
      maxOutputTokens: 2048,
      temperature:     0.1,
      topP:            0.8,
      responseMimeType: 'application/json',
    },
  }

  const url = `${GEMINI_API}/${MODEL}:generateContent?key=${apiKey}`

  // Retry up to 2 times on 429 / 503 with fast backoff
  let res
  for (let attempt = 0; attempt < 2; attempt++) {
    res = await fetch(url, {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(15_000),
    })
    if (res.ok) break
    if (res.status !== 429 && res.status !== 503) break
    if (attempt === 1) break
    await new Promise(r => setTimeout(r, 500 + Math.random() * 300))
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    const retryable = res.status === 503 || res.status === 429
    throw Object.assign(
      new Error(`Gemini API error ${res.status}: ${text.slice(0, 200)}`),
      { status: retryable ? 503 : 502, retryable }
    )
  }

  const data    = await res.json()
  const raw     = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!raw) throw new Error('Empty response from Gemini')

  return parseGeminiResponse(raw)
}

export async function isGeminiAvailable() {
  const key = process.env.GEMINI_API_KEY
  return !!(key && !key.startsWith('AIza_REPLACE'))
}

function parseGeminiResponse(text) {
  // Gemini with responseMimeType=application/json returns raw JSON
  // but occasionally wraps in markdown — handle both, plus a best-effort
  // extraction of the first balanced JSON object
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  let jsonStr = fenced ? fenced[1] : text.trim()
  try { return JSON.parse(jsonStr) } catch {}

  // Try to pull the first {...} block out of the text
  const firstBrace = jsonStr.indexOf('{')
  const lastBrace  = jsonStr.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try { return JSON.parse(jsonStr.slice(firstBrace, lastBrace + 1)) } catch {}
  }

  console.warn('[Gemini] could not parse JSON, raw text:', text.slice(0, 200))
  return {}
}
