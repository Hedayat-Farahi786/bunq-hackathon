import { useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  CheckCircle2, Circle, AlertCircle, Loader2, Plus, Trash2, Play, X,
} from 'lucide-react'
import api from '../api/client.js'

const BRAND = {
  github: { label: 'GH', bg: '#0a0a0a' },
  gitlab: { label: 'GL', bg: '#FC6D26' },
  jira: { label: 'JR', bg: '#2684FF' },
  slack: { label: 'SL', bg: '#611f69' },
}

export default function Integrations() {
  const [providers, setProviders] = useState([])
  const [runs, setRuns] = useState([])
  const [targets, setTargets] = useState({})
  const [notice, setNotice] = useState(null)
  const [params, setParams] = useSearchParams()

  const load = useCallback(async () => {
    const [p, r] = await Promise.all([
      api.get('/integrations/providers/'),
      api.get('/ingestion/runs/'),
    ])
    setProviders(p.data)
    setRuns(r.data)
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (params.get('connected')) {
      setNotice({ type: 'ok', msg: `Connected ${params.get('connected')} successfully.` })
      params.delete('connected'); setParams(params, { replace: true }); load()
    } else if (params.get('error')) {
      setNotice({ type: 'err', msg: `Connection failed: ${params.get('error')}` })
      params.delete('error'); params.delete('provider'); setParams(params, { replace: true })
    }
  }, [params, setParams, load])

  useEffect(() => {
    const active = runs.some((r) => ['pending', 'running'].includes(r.status))
    if (!active) return
    const t = setInterval(async () => {
      const { data } = await api.get('/ingestion/runs/')
      setRuns(data)
    }, 2500)
    return () => clearInterval(t)
  }, [runs])

  const parseTargets = (slug) =>
    (targets[slug] || '').split(',').map((s) => s.trim()).filter(Boolean)

  const connect = async (slug) => {
    try {
      const { data } = await api.post(`/integrations/${slug}/connect/`, { targets: parseTargets(slug) })
      window.location.href = data.authorize_url
    } catch (err) {
      setNotice({ type: 'err', msg: err.response?.data?.detail || 'Could not start OAuth.' })
    }
  }
  const disconnect = async (slug) => { await api.delete(`/integrations/${slug}/`); load() }
  const ingest = async (slug) => {
    try {
      await api.post(`/ingestion/${slug}/run/`, { targets: parseTargets(slug) })
      setNotice({ type: 'ok', msg: `Ingestion started for ${slug}.` })
      const { data } = await api.get('/ingestion/runs/')
      setRuns(data)
    } catch (err) {
      setNotice({ type: 'err', msg: err.response?.data?.detail || 'Could not start ingestion.' })
    }
  }

  return (
    <div className="px-8 py-7">
      <header className="animate-fade-up">
        <h1 className="text-[22px] font-semibold tracking-tight">Integrations</h1>
        <p className="mt-0.5 text-sm text-[var(--color-ink-soft)]">Connect your tools, then ingest activity to build your org lens.</p>
      </header>

      {notice && (
        <div className={`mt-5 flex items-center justify-between rounded-xl border px-4 py-2.5 text-sm animate-fade-up ${
          notice.type === 'ok'
            ? 'border-[var(--color-accent)]/30 bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
            : 'border-red-200 bg-red-50 text-red-600'}`}>
          {notice.msg}
          <button onClick={() => setNotice(null)}><X className="h-4 w-4" /></button>
        </div>
      )}

      <div className="stagger mt-6 grid gap-4 sm:grid-cols-2">
        {providers.map((p) => (
          <div key={p.slug} className="card card-hover p-5">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-xl text-xs font-bold text-white"
                  style={{ background: BRAND[p.slug]?.bg || '#0a0a0a' }}>
                  {BRAND[p.slug]?.label || p.slug.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <div className="font-semibold">{p.name}</div>
                  <div className="text-xs text-[var(--color-muted)]">
                    {p.connected ? `Connected as ${p.account_login || 'account'}`
                      : p.configured ? 'Ready to connect' : 'OAuth app not configured'}
                  </div>
                </div>
              </div>
              <StatusPill p={p} />
            </div>

            {(p.slug === 'github' || p.slug === 'gitlab') && (
              <input
                placeholder="Targets: owner or owner/repo (comma-separated, optional)"
                value={targets[p.slug] || ''}
                onChange={(e) => setTargets((t) => ({ ...t, [p.slug]: e.target.value }))}
                className="mt-4 w-full rounded-xl border border-[var(--color-line)] bg-white px-3 py-2 text-sm outline-none transition focus:border-[var(--color-accent)] focus:ring-4 focus:ring-[var(--color-accent-soft)]"
              />
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {!p.connected && (
                <button disabled={!p.configured} onClick={() => connect(p.slug)}
                  className="btn inline-flex items-center gap-1.5 rounded-xl bg-[var(--color-ink)] px-3.5 py-2 text-sm font-medium text-white hover:bg-black disabled:opacity-40">
                  <Plus className="h-4 w-4" /> Connect
                </button>
              )}
              {p.connected && p.ingestion_ready && (
                <button onClick={() => ingest(p.slug)}
                  className="btn inline-flex items-center gap-1.5 rounded-xl bg-[var(--color-accent)] px-3.5 py-2 text-sm font-medium text-white hover:brightness-95">
                  <Play className="h-4 w-4" /> Ingest now
                </button>
              )}
              {p.connected && !p.ingestion_ready && (
                <span className="rounded-xl bg-[var(--color-canvas)] px-3 py-2 text-xs text-[var(--color-muted)]">Ingestion coming soon</span>
              )}
              {p.connected && (
                <button onClick={() => disconnect(p.slug)}
                  className="btn inline-flex items-center gap-1.5 rounded-xl border border-[var(--color-line)] px-3 py-2 text-sm text-[var(--color-ink-soft)] hover:bg-[var(--color-canvas)]">
                  <Trash2 className="h-4 w-4" /> Disconnect
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <h2 className="mt-9 text-sm font-semibold text-[var(--color-ink-soft)]">Recent ingestion runs</h2>
      <div className="mt-3 space-y-2">
        {runs.length === 0 && <p className="text-sm text-[var(--color-muted)]">No runs yet.</p>}
        {runs.map((r) => (
          <div key={r.id} className="card flex items-center justify-between p-4">
            <div>
              <div className="text-sm font-medium capitalize">{r.provider}</div>
              {r.stats && Object.keys(r.stats).length > 0 && (
                <div className="mt-0.5 text-xs text-[var(--color-muted)]">
                  {Object.entries(r.stats).filter(([k]) => k !== 'profiles')
                    .map(([k, v]) => `${v} ${k}`).join(' · ')}
                </div>
              )}
              {r.error && <div className="mt-0.5 truncate text-xs text-red-600">{r.error.split('\n')[0]}</div>}
            </div>
            <RunStatus status={r.status} />
          </div>
        ))}
      </div>
    </div>
  )
}

function StatusPill({ p }) {
  if (p.connected) return <Badge icon={CheckCircle2} color="var(--color-accent)" label="Active" />
  if (p.configured) return <Badge icon={Circle} color="#8b8f96" label="Ready" />
  return <Badge icon={AlertCircle} color="#d97706" label="Setup" />
}

function RunStatus({ status }) {
  if (status === 'running' || status === 'pending')
    return <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-ink-soft)]"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {status}</span>
  if (status === 'success') return <Badge icon={CheckCircle2} color="var(--color-accent)" label="Success" />
  if (status === 'failed') return <Badge icon={AlertCircle} color="#dc2626" label="Failed" />
  return <Badge icon={Circle} color="#8b8f96" label={status} />
}

function Badge({ icon: Icon, color, label }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium capitalize" style={{ color }}>
      <Icon className="h-3.5 w-3.5" /> {label}
    </span>
  )
}
