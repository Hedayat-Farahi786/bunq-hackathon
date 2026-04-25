import React, { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  Sparkles, CheckCircle2, XCircle, Loader, FlaskConical,
  Sun, Moon, ShieldCheck, Wand2, Gauge, Bell, Snowflake, PiggyBank,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { aetherAI } from '../services/aetherAI.js'
import { useAetherStore } from '../store/aetherStore'

const BUNQ_ENV = import.meta.env.VITE_BUNQ_ENV || null

const PROVIDERS = [
  { id: 'auto',   label: 'Smart',         desc: 'Picks the best engine automatically' },
  { id: 'claude', label: 'Claude Sonnet', desc: 'Deep reasoning · best for receipts' },
  { id: 'gemini', label: 'Gemini Flash',  desc: 'Fast · great for quick questions' },
  { id: 'ollama', label: 'On-device',     desc: 'Private · runs locally' },
]

const RISK_OPTS = [
  { value: 'LOW',    label: 'Low'    },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH',   label: 'High'   },
]
const SCAN_OPTS = [
  { value: '1', label: '1s' },
  { value: '3', label: '3s' },
  { value: '5', label: '5s' },
]

export default function Settings() {
  const { user, accounts, prefs, updatePrefs, theme, setTheme } = useAetherStore()

  const [providerStatus, setProviderStatus] = useState(null)
  const [loadingProviders, setLoadingProviders] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState(aetherAI.getSelectedProvider())

  useEffect(() => {
    setLoadingProviders(true)
    aetherAI.getProviderStatus()
      .then(data => setProviderStatus(data))
      .catch(() => setProviderStatus(null))
      .finally(() => setLoadingProviders(false))
  }, [])

  const handleProviderChange = (id) => {
    setSelectedProvider(id)
    aetherAI.setProvider(id)
    toast.success(id === 'auto' ? 'Smart mode enabled' : `Switched to ${PROVIDERS.find(p => p.id === id)?.label}`)
  }

  const initials = (user?.name || 'A').split(' ').map(s => s[0]).join('').slice(0, 2).toUpperCase()

  return (
    <div className="setx">

      {/* ── Header ────────────────────────────────────────── */}
      <header className="setx-header">
        <p className="setx-eyebrow">Settings</p>
        <h1 className="setx-title">Settings</h1>
        <p className="setx-sub">Customize your Aether experience.</p>
      </header>

      {/* ── Identity card ─────────────────────────────────── */}
      <div className="setx-identity">
        <div className="setx-identity-avatar">{initials}</div>
        <div className="setx-identity-body">
          <div className="setx-identity-name">{user?.name || 'Welcome'}</div>
          <div className="setx-identity-meta">
            <span className={`setx-pill ${BUNQ_ENV === 'sandbox' ? 'amber' : 'green'}`}>
              {BUNQ_ENV === 'sandbox' ? <FlaskConical size={11} /> : <CheckCircle2 size={11} />}
              {BUNQ_ENV === 'sandbox' ? 'Sandbox' : 'Connected'}
            </span>
            <span className="setx-meta-dot" />
            <span className="setx-meta-text">{accounts.length} account{accounts.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
      </div>

      {/* ── Appearance ────────────────────────────────────── */}
      <Section icon={<Moon size={14} />} title="Appearance">
        <div className="setx-card">
          <div className="setx-row">
            <div className="setx-row-body">
              <div className="setx-row-title">Theme</div>
              <div className="setx-row-sub">Pick how the app should look</div>
            </div>
            <Seg
              value={theme}
              onChange={setTheme}
              options={[
                { value: 'dark',  label: 'Dark',  icon: <Moon size={12} /> },
                { value: 'light', label: 'Light', icon: <Sun  size={12} /> },
              ]}
            />
          </div>
        </div>
      </Section>

      {/* ── AI brain — commented out for now
      <Section icon={<Wand2 size={14} />} title="Aether's brain" hint="Which AI does the thinking">
        ...
      </Section>
      ── */}

      {/* ── Autonomy ──────────────────────────────────────── */}
      {/* ── Autonomy and Tuning removed — prefs not wired to real behavior ── */}

      {/* ── Reassurance ───────────────────────────────────── */}
      <div className="setx-reassure">
        <ShieldCheck size={18} />
        <div>
          <div className="setx-reassure-title">Your money moves only with your tap</div>
          <div className="setx-reassure-sub">Every action has a 10-second undo and a full entry in your activity log.</div>
        </div>
      </div>

      {/* ── About ─────────────────────────────────────────── */}
      <div className="setx-about">
        <div className="setx-about-orb">
          <img src="/aether-icon.svg" alt="" width={16} height={16} />
        </div>
        <div className="setx-about-text">
          <div className="setx-about-name">bunq Aether</div>
          <div className="setx-about-version">v1.0 · Hackathon 7.0</div>
        </div>
      </div>

      <div className="spacer" />
    </div>
  )
}

function Section({ icon, title, hint, children }) {
  return (
    <section className="setx-section">
      <div className="setx-section-head">
        <span className="setx-section-icon">{icon}</span>
        <span className="setx-section-title">{title}</span>
        {hint && <span className="setx-section-hint">{hint}</span>}
      </div>
      {children}
    </section>
  )
}

function Toggle({ icon, title, sub, on, onChange }) {
  return (
    <div className="setx-row is-toggle" onClick={onChange} role="button" tabIndex={0}>
      {icon && <span className="setx-row-icon">{icon}</span>}
      <div className="setx-row-body">
        <div className="setx-row-title">{title}</div>
        <div className="setx-row-sub">{sub}</div>
      </div>
      <button
        className={`setx-toggle ${on ? 'is-on' : ''}`}
        onClick={(e) => { e.stopPropagation(); onChange() }}
        aria-pressed={on}
      >
        <motion.span
          className="setx-toggle-knob"
          animate={{ x: on ? 22 : 2 }}
          transition={{ type: 'spring', stiffness: 500, damping: 36 }}
        />
      </button>
    </div>
  )
}

function Seg({ value, onChange, options }) {
  return (
    <div className="setx-seg">
      {options.map(o => {
        const active = String(value) === String(o.value)
        return (
          <button
            key={o.value}
            className={`setx-seg-btn ${active ? 'is-active' : ''}`}
            onClick={() => onChange(o.value)}
          >
            {active && (
              <motion.span
                layoutId="setx-seg-pill"
                className="setx-seg-pill"
                transition={{ type: 'spring', stiffness: 380, damping: 32 }}
              />
            )}
            <span className="setx-seg-content">
              {o.icon}
              {o.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}
