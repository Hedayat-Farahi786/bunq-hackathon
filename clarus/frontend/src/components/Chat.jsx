import { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import { useNavigate } from 'react-router-dom'
import { Aperture, ArrowUp } from 'lucide-react'
import { API_BASE, tokenStore } from '../api/client.js'

// Turn <contributor id="12">Name</contributor> into a markdown link to the profile.
function normalize(text) {
  return text.replace(
    /<contributor\s+id=["']?(\d+)["']?\s*>(.*?)<\/contributor>/g,
    (_, id, name) => `[${name}](/contributors/${id})`,
  )
}

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
}) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const bottomRef = useRef(null)
  const navigate = useNavigate()

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const ask = async (question) => {
    if (!question || streaming) return
    setInput('')
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

  return (
    <div className="card flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-[var(--color-line)] px-4 py-3 text-sm font-semibold">
        <Aperture className="h-4 w-4 text-[var(--color-accent)]" strokeWidth={2.2} /> {title}
      </div>

      <div className="flex-1 space-y-4 overflow-auto p-4">
        {messages.length === 0 && (
          <div className="flex h-full flex-col justify-center">
            <p className="text-sm text-[var(--color-ink-soft)]">{intro}</p>
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
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={placeholder}
          className="flex-1 rounded-xl border border-[var(--color-line)] bg-white px-3.5 py-2.5 text-sm outline-none transition focus:border-[var(--color-accent)] focus:ring-4 focus:ring-[var(--color-accent-soft)]"
        />
        <button disabled={streaming || !input.trim()}
          className="btn grid h-10 w-10 place-items-center rounded-xl bg-[var(--color-ink)] text-white hover:bg-black disabled:opacity-40">
          <ArrowUp className="h-4 w-4" />
        </button>
      </form>
    </div>
  )
}
