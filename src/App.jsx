import React, { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
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

  useEffect(() => { initializeApp() }, [])
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

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
        <div className="aether-orb" />
        <h1 className="splash-title">bunq <span className="accent">Aether</span></h1>
        <p className="splash-subtitle">Your autonomous financial guardian</p>
      </div>
      <div className="splash-loader">
        <div className="loader-bar" />
      </div>
    </div>
  )
}
