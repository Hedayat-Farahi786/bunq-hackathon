import { useState } from 'react'

// Avatar with a graceful initials fallback (handles missing or 404 image URLs).
export default function Avatar({ src, name, size = 44, className = '' }) {
  const [failed, setFailed] = useState(false)
  const initial = (name || '?').trim()[0]?.toUpperCase() || '?'
  const style = { width: size, height: size }

  if (!src || failed) {
    return (
      <div style={{ ...style, fontSize: size * 0.4 }}
        className={`grid shrink-0 place-items-center rounded-full bg-[var(--color-accent-soft)] font-semibold text-[var(--color-accent)] ${className}`}>
        {initial}
      </div>
    )
  }
  return (
    <img src={src} alt={name} style={style} onError={() => setFailed(true)}
      className={`shrink-0 rounded-full object-cover ${className}`} />
  )
}
