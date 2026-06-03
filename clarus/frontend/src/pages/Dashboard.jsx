import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FolderGit2, Users, GitCommit, GitPullRequest, ArrowRight, Cable } from 'lucide-react'
import api from '../api/client.js'
import OrgGraph from '../components/OrgGraph.jsx'
import Chat from '../components/Chat.jsx'
import Avatar from '../components/Avatar.jsx'

export default function Dashboard() {
  const [data, setData] = useState({ repositories: [], contributors: [] })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/data/').then(({ data }) => setData(data)).finally(() => setLoading(false))
  }, [])

  const { repositories, contributors } = data
  const sumWorks = (key) => contributors.reduce(
    (s, c) => s + (c.works || []).reduce((a, w) => a + (w[key] || 0), 0), 0)
  const commitTotal = sumWorks('commit_count')
  const prTotal = sumWorks('pr_count')

  const topContributors = [...contributors]
    .map((c) => ({ ...c, total: (c.works || []).reduce((s, w) => s + (w.commit_count || 0), 0) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 6)

  const empty = !loading && repositories.length === 0 && contributors.length === 0

  return (
    <div className="px-8 py-7">
      <header className="animate-fade-up">
        <h1 className="text-[22px] font-semibold tracking-tight">Organization Lens</h1>
        <p className="mt-0.5 text-sm text-[var(--color-ink-soft)]">A live map of who builds what across your tools.</p>
      </header>

      {empty ? (
        <div className="card mt-8 flex flex-col items-center px-12 py-16 text-center animate-fade-up">
          <div className="rounded-2xl bg-[var(--color-accent-soft)] p-3"><Cable className="h-6 w-6 text-[var(--color-accent)]" /></div>
          <div className="mt-4 text-lg font-semibold">No data yet</div>
          <p className="mt-1 text-sm text-[var(--color-ink-soft)]">Connect a source and run ingestion to build your org lens.</p>
          <Link to="/integrations"
            className="btn mt-5 inline-flex items-center gap-2 rounded-xl bg-[var(--color-ink)] px-4 py-2.5 text-sm font-medium text-white hover:bg-black">
            Go to Integrations <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      ) : (
        <>
          <div className="stagger mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat icon={FolderGit2} label="Repositories" value={repositories.length} />
            <Stat icon={Users} label="Contributors" value={contributors.length} />
            <Stat icon={GitCommit} label="Commits" value={commitTotal} />
            <Stat icon={GitPullRequest} label="Pull requests" value={prTotal} />
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-[1.5fr_1fr]">
            <div className="space-y-5">
              <Panel title="Organization network">
                <div className="h-[420px]">
                  <OrgGraph repositories={repositories} contributors={contributors} />
                </div>
              </Panel>
              <Panel title="Top contributors">
                <div className="grid gap-2 sm:grid-cols-2">
                  {topContributors.map((c) => (
                    <Link key={c.id} to={`/contributors/${c.id}`}
                      className="btn flex items-center gap-3 rounded-xl border border-[var(--color-line)] px-3 py-2 hover:bg-[var(--color-canvas)]">
                      <Avatar src={c.avatar_url} name={c.display_name || c.username} size={28} />
                      <span className="flex-1 truncate text-sm font-medium">{c.display_name || c.username}</span>
                      <span className="text-xs text-[var(--color-muted)]">{c.total} commits</span>
                    </Link>
                  ))}
                </div>
              </Panel>
            </div>
            <div className="h-[745px]">
              <Chat />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function Stat({ icon: Icon, label, value }) {
  return (
    <div className="card card-hover p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-[var(--color-muted)]">{label}</span>
        <Icon className="h-4 w-4 text-[var(--color-muted)]" />
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
    </div>
  )
}

function Panel({ title, children }) {
  return (
    <div className="card p-5 animate-fade-up">
      <div className="mb-3 text-sm font-semibold text-[var(--color-ink-soft)]">{title}</div>
      {children}
    </div>
  )
}

