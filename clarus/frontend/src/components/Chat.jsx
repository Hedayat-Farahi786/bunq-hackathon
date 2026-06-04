import { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import { useNavigate } from 'react-router-dom'
import { Aperture, ArrowUp, Mic, Square, Volume2, VolumeX } from 'lucide-react'
import { API_BASE, tokenStore } from '../api/client.js'

// Turn <contributor id="12">Name</contributor> into a markdown link to the profile.
function normalize(text) {
  return text.replace(
    /<contributor\s+id=["']?(\d+)["']?\s*>(.*?)<\/contributor>/g,
    (_, id, name) => `[${name}](/contributors/${id})`,
  )
}

// Strip markdown / tags so speech sounds natural.
function forSpeech(text) {
  return text
    .replace(/<contributor\s+id=["']?\d+["']?\s*>(.*?)<\/contributor>/g, '$1')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/[#*`_>]/g, '')
    .trim()
}

const SR = typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null
const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window

const DEFAULT_SUGGESTIONS = [
  'Who knows the most about payments?',
  'Summarize recent work in the web app',
]

export default function Chat({
  endpoint = '/api/insights/chat/',
  title = 'Ask Clarus',
  placeholder = 'Ask about your codebase…',
  intro = 'Ask anything about your organization.',
  suggestions = DEFAULT_SUGGESTIONS,
  voice = true,
}) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [listening, setListening] = useState(false)
  const [speakOn, setSpeakOn] = useState(false)
  const bottomRef = useRef(null)
  const recRef = useRef(null)
  const transcriptRef = useRef('')
  const speakOnRef = useRef(false)
  const navigate = useNavigate()

  useEffect(() => { speakOnRef.current = speakOn }, [speakOn])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])
  useEffect(() => () => {   // cleanup on unmount
    try { recRef.current?.abort?.() } catch { /* noop */ }
    if (canSpeak) window.speechSynthesis.cancel()
  }, [])

  const speak = (text) => {
    if (!speakOnRef.current || !canSpeak) return
    const clean = forSpeech(text)
    if (!clean) return
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(clean)
    u.rate = 1.05
    u.pitch = 1
    window.speechSynthesis.speak(u)
  }

  const ask = async (question) => {
    if (!question || streaming) return
    setInput('')
    if (canSpeak) window.speechSynthesis.cancel()
    setMessages((m) => [...m, { role: 'user', text: question }, { role: 'assistant', text: '' }])
    setStreaming(true)
    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenStore.access}`,
          'X-Org-Slug': tokenStore.org || '',
        },
        body: JSON.stringify({ prompt: question }),
      })
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let acc = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        acc += decoder.decode(value, { stream: true })
        setMessages((m) => {
          const copy = [...m]
          copy[copy.length - 1] = { role: 'assistant', text: acc }
          return copy
        })
      }
      speak(acc)
    } catch {
      setMessages((m) => {
        const copy = [...m]
        copy[copy.length - 1] = { role: 'assistant', text: 'Error contacting the assistant.' }
        return copy
      })
    } finally {
      setStreaming(false)
    }
  }

  const submit = (e) => { e.preventDefault(); ask(input.trim()) }

  const toggleMic = () => {
    if (!SR) return
    if (listening) { recRef.current?.stop(); return }
    const rec = new SR()
    rec.lang = 'en-US'
    rec.interimResults = true
    rec.continuous = false
    transcriptRef.current = ''
    rec.onresult = (e) => {
      const t = Array.from(e.results).map((r) => r[0].transcript).join(' ')
      transcriptRef.current = t
      setInput(t)
    }
    rec.onerror = () => setListening(false)
    rec.onend = () => {
      setListening(false)
      const t = transcriptRef.current.trim()
      if (t) ask(t)   // auto-send what was spoken
    }
    recRef.current = rec
    if (canSpeak) window.speechSynthesis.cancel()
    setListening(true)
    rec.start()
  }

  const toggleSpeak = () => {
    const next = !speakOn
    setSpeakOn(next)
    if (!next && canSpeak) window.speechSynthesis.cancel()
  }

  return (
    <div className="card flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-[var(--color-line)] px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Aperture className="h-4 w-4 text-[var(--color-accent)]" strokeWidth={2.2} /> {title}
        </div>
        {voice && canSpeak && (
          <button onClick={toggleSpeak} title={speakOn ? 'Mute spoken replies' : 'Speak replies aloud'}
            className={`btn rounded-lg p-1.5 ${speakOn ? 'text-[var(--color-accent)] bg-[var(--color-accent-soft)]' : 'text-[var(--color-muted)] hover:bg-[var(--color-canvas)]'}`}>
            {speakOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </button>
        )}
      </div>

      <div className="flex-1 space-y-4 overflow-auto p-4">
        {messages.length === 0 && (
          <div className="flex h-full flex-col justify-center">
            <p className="text-sm text-[var(--color-ink-soft)]">{intro}</p>
            {voice && SR && (
              <p className="mt-1 text-xs text-[var(--color-muted)]">Tip: tap the mic to talk.</p>
            )}
            <div className="mt-3 space-y-2">
              {suggestions.map((s) => (
                <button key={s} onClick={() => ask(s)}
                  className="btn block w-full rounded-xl border border-[var(--color-line)] px-3 py-2 text-left text-sm text-[var(--color-ink-soft)] hover:bg-[var(--color-canvas)] hover:text-[var(--color-ink)]">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`animate-fade-up ${m.role === 'user' ? 'text-right' : ''}`}>
            <div className={`inline-block max-w-[90%] rounded-2xl px-3.5 py-2 text-sm ${
              m.role === 'user'
                ? 'bg-[var(--color-ink)] text-white'
                : 'bg-[var(--color-canvas)] text-[var(--color-ink)]'}`}>
              {m.role === 'assistant' ? (
                <div className="prose prose-sm max-w-none prose-p:my-1.5 [&_a]:font-medium [&_a]:text-[var(--color-accent)]">
                  <ReactMarkdown
                    components={{
                      a: ({ href, children }) => (
                        <a onClick={(e) => { e.preventDefault(); navigate(href) }} href={href}>{children}</a>
                      ),
                    }}
                  >
                    {normalize(m.text) || '…'}
                  </ReactMarkdown>
                </div>
              ) : m.text}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={submit} className="flex items-center gap-2 border-t border-[var(--color-line)] p-3">
        {voice && (
          <button type="button" onClick={toggleMic} disabled={!SR}
            title={!SR ? 'Voice input needs Chrome or Edge' : listening ? 'Stop' : 'Talk'}
            className={`btn grid h-10 w-10 shrink-0 place-items-center rounded-xl ${
              listening
                ? 'bg-red-500 text-white animate-pulse'
                : 'border border-[var(--color-line)] text-[var(--color-ink-soft)] hover:bg-[var(--color-canvas)] disabled:opacity-40'}`}>
            {listening ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </button>
        )}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={listening ? 'Listening…' : placeholder}
          className="flex-1 rounded-xl border border-[var(--color-line)] bg-white px-3.5 py-2.5 text-sm outline-none transition focus:border-[var(--color-accent)] focus:ring-4 focus:ring-[var(--color-accent-soft)]"
        />
        <button disabled={streaming || !input.trim()}
          className="btn grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--color-ink)] text-white hover:bg-black disabled:opacity-40">
          <ArrowUp className="h-4 w-4" />
        </button>
      </form>
    </div>
  )
}
