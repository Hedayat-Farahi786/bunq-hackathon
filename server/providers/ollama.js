/**
 * Ollama provider — local LLM inference
 * Runs on your machine via `ollama serve`
 * Docs: https://github.com/ollama/ollama/blob/main/docs/api.md
 *
 * Supports vision if you use a vision-capable model:
 *   ollama pull llava          (vision, 7B)
 *   ollama pull llama3.2-vision (vision, 11B)
 *   ollama pull llama3.2       (text-only, fast, 3B)
 *   ollama pull mistral        (text-only, quality)
 */

export async function callOllama({ systemPrompt, userMessage, imageBase64, priorTurns = [] }) {
  const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
  const model   = process.env.OLLAMA_MODEL    || 'llama3.2'

  const isVisionModel = model.includes('vision') || model.includes('llava')

  const messages = [
    { role: 'system', content: systemPrompt },
  ]

  for (const turn of priorTurns) {
    const userText = (turn.voice_text || '').trim()
    const reply    = (turn.voice_response || '').trim()
    if (userText) messages.push({ role: 'user',      content: userText })
    if (reply)    messages.push({ role: 'assistant', content: reply })
  }

  if (imageBase64 && isVisionModel) {
    messages.push({
      role:    'user',
      content: userMessage,
      images:  [imageBase64],
    })
  } else {
    // Text-only fallback — strip image reference from message
    const textOnlyMsg = imageBase64
      ? `[Camera frame available but model is text-only]\n\n${userMessage}`
      : userMessage
    messages.push({ role: 'user', content: textOnlyMsg })
  }

  const body = {
    model,
    messages,
    stream: false,
    format: 'json',
    options: {
      temperature: 0.4,
      num_predict: 1024,
    },
  }

  let res
  try {
    res = await fetch(`${baseUrl}/api/chat`, {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(60_000), // local models can be slow
    })
  } catch (err) {
    throw Object.assign(
      new Error(`Cannot reach Ollama at ${baseUrl}. Is \`ollama serve\` running? (${err.message})`),
      { status: 503 }
    )
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw Object.assign(
      new Error(`Ollama error ${res.status}: ${text.slice(0, 200)}`),
      { status: 502 }
    )
  }

  const data = await res.json()
  const raw  = data.message?.content
  if (!raw) throw new Error('Empty response from Ollama')

  return parseOllamaResponse(raw)
}

export async function isOllamaAvailable() {
  const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
  try {
    const res = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(2_000),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function getOllamaModels() {
  const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
  try {
    const res  = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3_000) })
    const data = await res.json()
    return data.models?.map(m => m.name) || []
  } catch {
    return []
  }
}

function parseOllamaResponse(text) {
  const match   = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  const jsonStr = match ? match[1] : text.trim()
  try {
    return JSON.parse(jsonStr)
  } catch {
    return {
      scene: { type: 'UNKNOWN', description: 'Local model analysis', confidence: 0.4 },
      risk:  { level: 'LOW', reason: 'Text-based analysis (no vision)' },
      overlayHints: [],
      recommendedActions: [],
      voiceResponse: text.slice(0, 300),
      insight: 'Using local Ollama model — install a vision model for camera analysis.',
    }
  }
}
