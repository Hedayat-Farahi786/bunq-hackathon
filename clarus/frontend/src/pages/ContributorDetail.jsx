import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import { ArrowLeft, ExternalLink, Sparkles, GitCommit, GitPullRequest, CircleDot } from 'lucide-react'
import api from '../api/client.js'
import Avatar from '../components/Avatar.jsx'
import Chat from '../components/Chat.jsx'

export default function ContributorDetail() {
  const { id } = useParams()
  const [c, setC] = useState(null)

  useEffect(() => { api.get(`/contributors/${id}/`).then(({ data }) => setC(data)) }, [id])

  if (!c) return <div className="px-8 py-7 text-sm text-[var(--color-muted)]">Loading…</div>

  return (
    <div className="mx-auto max-w-3xl px-8 py-7 animate-fade-up">
      <Link to="/contributors" className="inline-flex items-center gap-1.5 text-sm text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]">
        <ArrowLeft className="h-4 w-4" /> Contributors
      </Link>

      <div className="mt-5 flex items-center gap-4">
        <Avatar src={c.avatar_url} name={c.display_name || c.username} size={64} />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{c.display_name || c.username}</h1>
          <a href={c.url} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm font-medium text-[var(--color-accent)] hover:underline">
            @{c.username} <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>

      {c.summary && (
        <div className="card mt-6 p-5">
          <div className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-ink-soft)]">
            <Sparkles className="h-4 w-4 text-[var(--color-accent)]" /> AI profile
          </div>
          <div className="prose prose-sm max-w-none text-[var(--color-ink)]"><ReactMarkdown>{c.summary}</ReactMarkdown></div>
        </div>
      )}

      <div className="mt-8">
        <div className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-ink-soft)]">
          <Sparkles className="h-4 w-4 text-[var(--color-accent)]" /> Digital twin
        </div>
        <p className="mb-3 text-xs text-[var(--color-muted)]">
          Chat with an AI grounded in {c.display_name || c.username}'s work — get context before reaching out.
        </p>
        <div className="h-[460px]">
          <Chat
            endpoint={`/api/insights/contributors/${c.id}/chat/`}
            title={`${c.display_name || c.username}'s digital twin`}
            placeholder={`Ask ${c.display_name || c.username} anything…`}
            intro={`I'm ${c.display_name || c.username}'s digital twin, built from their work. Ask me what I know.`}
            suggestions={['What are you most experienced with?', 'Could you help with the frontend?']}
          />
        </div>
      </div>

      <h2 className="mt-8 text-sm font-semibold text-[var(--color-ink-soft)]">Work by repository</h2>
      <div className="mt-3 space-y-3">
        {(c.works || []).map((w) => (
          <div key={w.id} className="card p-4">
            <div className="flex items-center justify-between">
              <span className="font-semibold">{w.repository_name}</span>
              <div className="flex items-center gap-3 text-xs text-[var(--color-muted)]">
                <span className="inline-flex items-center gap-1"><GitCommit className="h-3.5 w-3.5" />{w.commit_count}</span>
                <span className="inline-flex items-center gap-1"><GitPullRequest className="h-3.5 w-3.5" />{w.pr_count}</span>
                <span className="inline-flex items-center gap-1"><CircleDot className="h-3.5 w-3.5" />{w.issue_count}</span>
              </div>
            </div>
            {w.summary && <p className="mt-2 text-sm text-[var(--color-ink-soft)]">{w.summary}</p>}
            {w.commits?.length > 0 && (
              <ul className="mt-2 space-y-1">
                {w.commits.slice(0, 5).map((cm) => (
                  <li key={cm.id} className="truncate text-xs text-[var(--color-muted)]">• {cm.message}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {(c.works || []).length === 0 && <p className="text-sm text-[var(--color-muted)]">No work recorded.</p>}
      </div>
    </div>
  )
}
