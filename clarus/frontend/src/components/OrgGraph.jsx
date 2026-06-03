import { useNavigate } from 'react-router-dom'

// Lightweight dependency-free org network: repositories in the center,
// contributors arranged around them, edges = "works on" relationships.
export default function OrgGraph({ repositories = [], contributors = [] }) {
  const navigate = useNavigate()
  const W = 720, H = 420, cx = W / 2, cy = H / 2

  const repoPos = repositories.slice(0, 8).map((r, i, arr) => {
    const angle = (i / Math.max(arr.length, 1)) * Math.PI * 2
    return { ...r, x: cx + Math.cos(angle) * 90, y: cy + Math.sin(angle) * 70 }
  })
  const repoIndex = Object.fromEntries(repoPos.map((r) => [r.id, r]))

  const people = contributors.slice(0, 24).map((c, i, arr) => {
    const angle = (i / Math.max(arr.length, 1)) * Math.PI * 2
    return { ...c, x: cx + Math.cos(angle) * 300, y: cy + Math.sin(angle) * 175 }
  })

  // Edge from each contributor to the first repo they work on (if available).
  const edges = people.map((p) => {
    const repoId = (p.works || [])[0]?.repository
    const repo = repoIndex[repoId] || repoPos[0]
    return repo ? { x1: p.x, y1: p.y, x2: repo.x, y2: repo.y, key: p.id } : null
  }).filter(Boolean)

  if (repositories.length === 0 && contributors.length === 0) {
    return <div className="flex h-full items-center justify-center text-sm text-[var(--color-muted)]">No data yet — connect a source and ingest.</div>
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full">
      {edges.map((e) => (
        <line key={e.key} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke="rgba(10,10,10,0.08)" />
      ))}
      {people.map((p) => (
        <g key={p.id} className="cursor-pointer" onClick={() => navigate(`/contributors/${p.id}`)}>
          <circle cx={p.x} cy={p.y} r="6" fill="#16a34a" className="transition-[r] duration-150 hover:[r:8]" />
          <title>{p.username}</title>
        </g>
      ))}
      {repoPos.map((r) => (
        <g key={r.id}>
          <circle cx={r.x} cy={r.y} r="9" fill="#0a0a0a" />
          <circle cx={r.x} cy={r.y} r="9" fill="none" stroke="#16a34a" strokeWidth="2" opacity="0.5" />
          <text x={r.x} y={r.y - 15} textAnchor="middle" fontSize="10" fontWeight="600" fill="#52555b">
            {r.name.split('/').pop()}
          </text>
        </g>
      ))}
    </svg>
  )
}
