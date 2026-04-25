import React from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Home, Zap, Clock, Settings } from 'lucide-react'

const TABS = [
  { to: '/',         icon: Home,     label: 'Home' },
  { to: '/aether',   icon: Zap,      label: 'Aether' },
  { to: '/log',      icon: Clock,    label: 'Activity' },
  { to: '/settings', icon: Settings, label: 'Settings' },
]

export default function NavBar() {
  const { pathname } = useLocation()
  if (pathname === '/onboarding' || pathname === '/aether') return null

  return (
    <nav className="bnav">
      {TABS.map(tab => {
        const Icon = tab.icon
        const active = pathname === tab.to
        return (
          <NavLink key={tab.to} to={tab.to} className={`bnav-tab ${active ? 'is-active' : ''}`}>
            {active && <motion.span layoutId="bnav-bg" className="bnav-bg" transition={{ type: 'spring', stiffness: 500, damping: 34 }} />}
            <Icon size={20} strokeWidth={active ? 2 : 1.4} />
            <span className="bnav-label">{tab.label}</span>
          </NavLink>
        )
      })}
    </nav>
  )
}
