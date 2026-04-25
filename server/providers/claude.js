/**
 * Claude provider — Anthropic Messages API
 * Model: claude-sonnet-4-6 (best quality for financial reasoning + vision)
 * Docs: https://docs.anthropic.com/en/api/messages
 */

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages'
const MODEL         = 'claude-sonnet-4-6'

export async function callClaude({ systemPrompt, userMessage, imageBase64, priorTurns = [] }) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!isUsableClaudeKey(apiKey)) {
    throw Object.assign(new Error('Anthropic API key not configured'), { status: 503 })
  }

  // Replay earlier user↔assistant turns so Claude can carry context across the
  // conversation. We skip the image on prior turns to keep the prompt compact.
  const messages = []
  for (const turn of priorTurns) {
    const userText = (turn.voice_text || '').trim()
    const reply    = (turn.voice_response || '').trim()
    if (userText) messages.push({ role: 'user',      content: [{ type: 'text', text: userText }] })
    if (reply)    messages.push({ role: 'assistant', content: [{ type: 'text', text: reply }] })
  }

  const content = []
  if (imageBase64) {
    content.push({
      type:   'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 },
    })
  }
  content.push({ type: 'text', text: userMessage })
  messages.push({ role: 'user', content })

  const body = {
    model:      MODEL,
    max_tokens: 2048,
    system:     systemPrompt,
    messages,
  }

  const res = await fetch(ANTHROPIC_API, {
    method:  'POST',
    headers: {
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw Object.assign(
      new Error(`Anthropic API error ${res.status}: ${text.slice(0, 200)}`),
      { status: res.status === 429 ? 429 : 502 }
    )
  }

  const data = await res.json()
  const raw  = data.content?.[0]?.text
  if (!raw) throw new Error('Empty response from Claude')

  return parseAIResponse(raw)
}

export async function isClaudeAvailable() {
  return isUsableClaudeKey(process.env.ANTHROPIC_API_KEY)
}

// Anthropic keys are always "sk-ant-" + a long base64-ish blob (> 40 chars).
// Reject the .env.example placeholders ("sk-ant-...", "sk-ant-REPLACE...") so
// the /providers endpoint doesn't falsely claim Claude is configured.
function isUsableClaudeKey(key) {
  if (!key || typeof key !== 'string') return false
  const trimmed = key.trim()
  if (!trimmed.startsWith('sk-ant-')) return false
  if (trimmed.startsWith('sk-ant-REPLACE')) return false
  if (trimmed.length < 20) return false
  if (/\.\.\.$/.test(trimmed)) return false   // placeholder "sk-ant-..."
  return true
}

function parseAIResponse(text) {
  // Claude returns JSON inside a markdown code block sometimes
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  const jsonStr = fenced ? fenced[1] : text.trim()
  try { return JSON.parse(jsonStr) } catch {}

  // Best-effort: extract the first balanced JSON object
  const firstBrace = jsonStr.indexOf('{')
  const lastBrace  = jsonStr.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try { return JSON.parse(jsonStr.slice(firstBrace, lastBrace + 1)) } catch {}
  }

  console.warn('[Claude] could not parse JSON, raw text:', text.slice(0, 200))
  return {}
}
