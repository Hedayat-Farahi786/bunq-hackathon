import React, { useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAetherStore } from './store/aetherStore'
import Dashboard from './pages/Dashboard'
import AetherMode from './pages/AetherMode'
import ActionLog from './pages/ActionLog'
import Settings from './pages/Settings'
import Onboarding from './pages/Onboarding'
import NavBar from './components/NavBar'
import ActionToast from './components/ActionToast'

export default function App() {
  const { initialized, loading, initializeApp, theme } = useAetherStore()
  const location = useLocation()

  useEffect(() => { initializeApp() }, [])
  useEffect(() => { document.documentElement.dataset.theme = theme }, [theme])
  useEffect(() => { window.scrollTo(0, 0); document.querySelector('.page-content')?.scrollTo(0, 0) }, [location.pathname])

  if (!initialized) return <SplashScreen />

  return (
    <div className={`app-shell app-shell--${theme}`}>
      <NavBar />
      <div className="page-content scrollable">
        <Routes>
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/"           element={<Dashboard />} />
          <Route path="/aether"     element={<AetherMode />} />
          <Route path="/log"        element={<ActionLog />} />
          <Route path="/settings"   element={<Settings />} />
          <Route path="*"           element={<Navigate to="/" replace />} />
        </Routes>
      </div>
      <ActionToast />
    </div>
  )
}

function SplashScreen() {
  return (
    <div className="splash-screen">
      <div className="splash-logo">
        <div style={{ width: 48, height: 48, borderRadius: 14, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
          <img src="/aether-icon.svg" alt="" width={24} height={24} />
        </div>
        <h1 className="splash-title">bunq <span className="accent">Aether</span></h1>
        <p className="splash-subtitle">Your autonomous financial guardian</p>
      </div>
      <div className="splash-loader">
        <div className="loader-bar" />
      </div>
    </div>
  )
}
