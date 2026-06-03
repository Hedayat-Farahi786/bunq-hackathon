import { Link, useLocation } from 'react-router-dom'
import { Aperture, LayoutDashboard, Users, FolderGit2, Cable, LogOut } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/contributors', label: 'Contributors', icon: Users },
  { to: '/repositories', label: 'Repositories', icon: FolderGit2 },
  { to: '/integrations', label: 'Integrations', icon: Cable },
]

export default function Layout({ children }) {
  const { pathname } = useLocation()
  const { user, orgs, activeOrg, switchOrg, logout } = useAuth()

  return (
    <div className="flex min-h-screen bg-[var(--color-canvas)]">
      <aside className="flex w-64 shrink-0 flex-col border-r border-[var(--color-line)] bg-white">
        <div className="flex items-center gap-2 px-6 py-5">
          <Aperture className="h-6 w-6 text-[var(--color-accent)]" strokeWidth={2.2} />
          <span className="text-lg font-semibold tracking-tight">Clarus</span>
        </div>

        <div className="px-4 pb-4">
          <label className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
            Organization
          </label>
          <select
            value={activeOrg || ''}
            onChange={(e) => switchOrg(e.target.value)}
            className="mt-1.5 w-full rounded-xl border border-[var(--color-line)] bg-white px-3 py-2 text-sm font-medium outline-none transition focus:border-[var(--color-accent)]"
          >
            {orgs.map((o) => <option key={o.slug} value={o.slug}>{o.name}</option>)}
          </select>
        </div>

        <nav className="flex-1 space-y-1 px-3">
          {NAV.map(({ to, label, icon: Icon }) => {
            const active = pathname === to
            return (
              <Link
                key={to}
                to={to}
                className={`btn flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium ${
                  active
                    ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                    : 'text-[var(--color-ink-soft)] hover:bg-[var(--color-canvas)] hover:text-[var(--color-ink)]'
                }`}
              >
                <Icon className="h-[18px] w-[18px]" strokeWidth={active ? 2.3 : 2} />
                {label}
              </Link>
            )
          })}
        </nav>

        <div className="m-3 flex items-center justify-between rounded-xl border border-[var(--color-line)] bg-white p-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{user?.full_name || 'Account'}</div>
            <div className="truncate text-xs text-[var(--color-muted)]">{user?.email}</div>
          </div>
          <button onClick={logout} title="Sign out"
            className="btn rounded-lg p-2 text-[var(--color-muted)] hover:bg-[var(--color-canvas)] hover:text-[var(--color-ink)]">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <div className="animate-fade-in">{children}</div>
      </main>
    </div>
  )
}
