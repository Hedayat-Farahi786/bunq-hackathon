import React from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { LayoutGrid, ScrollText, SlidersHorizontal, Sparkles } from 'lucide-react'
import { useAetherStore } from '../store/aetherStore'

const LINKS = [
  { to: '/',         icon: LayoutGrid,         label: 'Home'     },
  { to: '/log',      icon: ScrollText,         label: 'Activity' },
  { to: '/settings', icon: SlidersHorizontal,  label: 'Settings' },
]

export default function NavBar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { actionLog, aetherActive } = useAetherStore()

  if (location.pathname === '/onboarding') return null
  if (location.pathname === '/aether')     return null

  const pendingCount = actionLog.filter(a => a.status === 'executing').length

  return (
    <nav className="navx" role="navigation" aria-label="Primary">

      {/* ── Brand (desktop only) ───────────────────────────── */}
      <div className="navx-brand">
        <div className="navx-brand-orb">
          <img src="/aether-icon.svg" alt="" width={18} height={18} />
        </div>
        <div className="navx-brand-text">
          <span className="navx-brand-name">bunq</span>
          <span className="navx-brand-sub">Aether</span>
        </div>
      </div>

      {/* ── Primary links ───────────────────────────────────── */}
      <div className="navx-list">
        {LINKS.map(link => {
          const Icon = link.icon
          const active = location.pathname === link.to
          return (
            <NavLink
              key={link.to}
              to={link.to}
              className={`navx-item ${active ? 'is-active' : ''}`}
            >
              {active && (
                <motion.span
                  layoutId="navx-pill"
                  className="navx-pill"
                  transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                />
              )}
              <span className="navx-icon">
                <Icon size={20} strokeWidth={active ? 2.1 : 1.7} />
                {link.to === '/log' && pendingCount > 0 && (
                  <span className="navx-badge">{pendingCount}</span>
                )}
              </span>
              <span className="navx-label">{link.label}</span>
            </NavLink>
          )
        })}
      </div>

      {/* ── Aether AI launcher (desktop CTA · mobile inline) ── */}
      <button
        className={`navx-cta ${aetherActive ? 'is-live' : ''}`}
        onClick={() => navigate('/aether')}
        aria-label="Open Aether AI"
      >
        <span className="navx-cta-orb">
          <Sparkles size={14} />
        </span>
        <span className="navx-cta-text">
          <span className="navx-cta-title">Aether AI</span>
          <span className="navx-cta-sub">
            <span className="navx-cta-dot" />
            {aetherActive ? 'Live' : 'Tap to talk'}
          </span>
        </span>
      </button>
    </nav>
  )
}
