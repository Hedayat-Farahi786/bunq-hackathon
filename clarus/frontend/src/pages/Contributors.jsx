import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search } from 'lucide-react'
import api from '../api/client.js'
import Avatar from '../components/Avatar.jsx'

export default function Contributors() {
  const [contributors, setContributors] = useState([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/contributors/').then(({ data }) => setContributors(data)).finally(() => setLoading(false))
  }, [])

  const filtered = contributors.filter((c) =>
    (c.username + (c.display_name || '') + (c.summary || '')).toLowerCase().includes(q.toLowerCase()))

  return (
    <div className="px-8 py-7">
      <header className="animate-fade-up">
        <h1 className="text-[22px] font-semibold tracking-tight">Contributors</h1>
        <p className="mt-0.5 text-sm text-[var(--color-ink-soft)]">Find the right expert by name or what they work on.</p>
      </header>

      <div className="relative mt-5 max-w-md animate-fade-up">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted)]" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name or expertise…"
          className="w-full rounded-xl border border-[var(--color-line)] bg-white py-2.5 pl-10 pr-3 text-sm outline-none transition focus:border-[var(--color-accent)] focus:ring-4 focus:ring-[var(--color-accent-soft)]"
        />
      </div>

      {loading ? <p className="mt-6 text-sm text-[var(--color-muted)]">Loading…</p> : (
        <div className="stagger mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => (
            <Link key={c.id} to={`/contributors/${c.id}`} className="card card-hover p-5">
              <div className="flex items-center gap-3">
                <Avatar src={c.avatar_url} name={c.display_name || c.username} size={44} />
                <div className="min-w-0">
                  <div className="truncate font-semibold">{c.display_name || c.username}</div>
                  <div className="truncate text-xs text-[var(--color-muted)]">@{c.username} · {c.provider}</div>
                </div>
              </div>
              {c.summary && <p className="mt-3 line-clamp-3 text-sm text-[var(--color-ink-soft)]">{c.summary}</p>}
            </Link>
          ))}
          {filtered.length === 0 && <p className="text-sm text-[var(--color-muted)]">No contributors found.</p>}
        </div>
      )}
    </div>
  )
}
