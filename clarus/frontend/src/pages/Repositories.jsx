import { useEffect, useState } from 'react'
import { FolderGit2, ExternalLink } from 'lucide-react'
import api from '../api/client.js'

export default function Repositories() {
  const [repos, setRepos] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/repositories/').then(({ data }) => setRepos(data)).finally(() => setLoading(false))
  }, [])

  return (
    <div className="px-8 py-7">
      <header className="animate-fade-up">
        <h1 className="text-[22px] font-semibold tracking-tight">Repositories</h1>
        <p className="mt-0.5 text-sm text-[var(--color-ink-soft)]">Everything Clarus has ingested across your sources.</p>
      </header>

      {loading ? <p className="mt-6 text-sm text-[var(--color-muted)]">Loading…</p> : (
        <div className="stagger mt-6 grid gap-4 sm:grid-cols-2">
          {repos.map((r) => (
            <a key={r.id} href={r.url} target="_blank" rel="noreferrer" className="card card-hover group p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--color-canvas)]">
                    <FolderGit2 className="h-4 w-4 text-[var(--color-ink-soft)]" />
                  </div>
                  <span className="font-semibold">{r.name}</span>
                </div>
                <ExternalLink className="h-4 w-4 text-[var(--color-muted)] opacity-0 transition group-hover:opacity-100" />
              </div>
              {(r.summary || r.description) && (
                <p className="mt-3 line-clamp-3 text-sm text-[var(--color-ink-soft)]">{r.summary || r.description}</p>
              )}
              <div className="mt-3 text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">{r.provider}</div>
            </a>
          ))}
          {repos.length === 0 && <p className="text-sm text-[var(--color-muted)]">No repositories yet.</p>}
        </div>
      )}
    </div>
  )
}
