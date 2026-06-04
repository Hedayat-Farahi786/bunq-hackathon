import { useEffect, useMemo, useState } from 'react'
import { X, Search, Lock, Globe, Loader2, Check, Play } from 'lucide-react'
import api from '../api/client.js'

export default function RepoPicker({ provider, onClose, onIngested }) {
  const [repos, setRepos] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [publicOnly, setPublicOnly] = useState(true)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [ingesting, setIngesting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get(`/integrations/${provider.slug}/repositories/`)
      .then(({ data }) => {
        setRepos(data.repositories)
        setSelected(new Set(data.selected || []))
      })
      .catch((e) => setError(e.response?.data?.detail || 'Failed to load repositories.'))
      .finally(() => setLoading(false))
  }, [provider.slug])

  const visible = useMemo(() => {
    const q = query.toLowerCase()
    return repos.filter((r) =>
      (!publicOnly || !r.private) && r.name.toLowerCase().includes(q))
  }, [repos, publicOnly, query])

  const togglePublicOnly = () => {
    const next = !publicOnly
    setPublicOnly(next)
    if (next) {
      // drop private repos from the selection when restricting to public
      setSelected((prev) => {
        const keep = new Set(prev)
        repos.forEach((r) => { if (r.private) keep.delete(r.name) })
        return keep
      })
    }
  }

  const toggle = (name) => setSelected((prev) => {
    const next = new Set(prev)
    next.has(name) ? next.delete(name) : next.add(name)
    return next
  })
  const selectAllVisible = () => setSelected((prev) => {
    const next = new Set(prev); visible.forEach((r) => next.add(r.name)); return next
  })
  const clearVisible = () => setSelected((prev) => {
    const next = new Set(prev); visible.forEach((r) => next.delete(r.name)); return next
  })

  const ingest = async () => {
    setIngesting(true); setError('')
    try {
      await api.post(`/ingestion/${provider.slug}/run/`, {
        targets: [...selected],
        public_only: publicOnly,
      })
      onIngested?.()
      onClose()
    } catch (e) {
      setError(e.response?.data?.detail || 'Could not start ingestion.')
      setIngesting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 animate-fade-in"
      onClick={onClose}>
      <div className="card flex max-h-[85vh] w-full max-w-2xl flex-col animate-fade-up"
        onClick={(e) => e.stopPropagation()}>
        {/* header */}
        <div className="flex items-center justify-between border-b border-[var(--color-line)] px-5 py-4">
          <div>
            <div className="font-semibold">Select repositories</div>
            <div className="text-xs text-[var(--color-muted)]">{provider.name} · choose what Clarus ingests</div>
          </div>
          <button onClick={onClose} className="btn rounded-lg p-1.5 text-[var(--color-muted)] hover:bg-[var(--color-canvas)]">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* controls */}
        <div className="flex flex-wrap items-center gap-3 border-b border-[var(--color-line)] px-5 py-3">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted)]" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search repositories…"
              className="w-full rounded-xl border border-[var(--color-line)] bg-white py-2 pl-9 pr-3 text-sm outline-none transition focus:border-[var(--color-accent)] focus:ring-4 focus:ring-[var(--color-accent-soft)]" />
          </div>
          <button onClick={togglePublicOnly}
            className={`btn inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium ${
              publicOnly ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                         : 'border-[var(--color-line)] text-[var(--color-ink-soft)]'}`}>
            {publicOnly ? <Globe className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
            {publicOnly ? 'Public only' : 'All repos'}
          </button>
        </div>

        <div className="flex items-center justify-between px-5 py-2 text-xs text-[var(--color-muted)]">
          <span>{visible.length} shown · {selected.size} selected</span>
          <span className="flex gap-3">
            <button onClick={selectAllVisible} className="hover:text-[var(--color-ink)]">Select all</button>
            <button onClick={clearVisible} className="hover:text-[var(--color-ink)]">Clear</button>
          </span>
        </div>

        {/* list */}
        <div className="flex-1 overflow-auto px-3 pb-2">
          {loading && <div className="flex items-center gap-2 p-6 text-sm text-[var(--color-muted)]"><Loader2 className="h-4 w-4 animate-spin" /> Loading repositories…</div>}
          {error && <div className="m-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
          {!loading && visible.map((r) => {
            const checked = selected.has(r.name)
            return (
              <button key={r.external_id} onClick={() => toggle(r.name)}
                className="btn flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-[var(--color-canvas)]">
                <span className={`grid h-5 w-5 place-items-center rounded-md border ${
                  checked ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-white' : 'border-[var(--color-line)]'}`}>
                  {checked && <Check className="h-3.5 w-3.5" />}
                </span>
                {r.private ? <Lock className="h-3.5 w-3.5 text-[var(--color-muted)]" /> : <Globe className="h-3.5 w-3.5 text-[var(--color-muted)]" />}
                <span className="flex-1 truncate text-sm font-medium">{r.name}</span>
                {r.description && <span className="hidden truncate text-xs text-[var(--color-muted)] sm:block sm:max-w-[40%]">{r.description}</span>}
              </button>
            )
          })}
          {!loading && visible.length === 0 && <p className="p-6 text-sm text-[var(--color-muted)]">No repositories match.</p>}
        </div>

        {/* footer */}
        <div className="flex items-center justify-between border-t border-[var(--color-line)] px-5 py-3">
          <span className="text-sm text-[var(--color-ink-soft)]">{selected.size} repositories selected</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn rounded-xl border border-[var(--color-line)] px-3.5 py-2 text-sm text-[var(--color-ink-soft)] hover:bg-[var(--color-canvas)]">Cancel</button>
            <button onClick={ingest} disabled={ingesting || selected.size === 0}
              className="btn inline-flex items-center gap-1.5 rounded-xl bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:brightness-95 disabled:opacity-40">
              {ingesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Ingest {selected.size || ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
