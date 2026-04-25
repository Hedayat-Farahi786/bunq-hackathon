import React, { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { useAetherStore } from '../store/aetherStore'
import { aetherAI } from '../services/aetherAI'
import { memoryAPI } from '../services/memoryAPI'
import {
  Settings, Loader, Eye,
  TrendingDown, TrendingUp, Moon, Sun, Bell,
  ChevronRight, ArrowUpRight, ArrowDownLeft,
  Plus, Send, ArrowLeftRight, CreditCard, PiggyBank, Users, Sparkles,
  Snowflake, Lock,
} from 'lucide-react'
import UndoBar from '../components/UndoBar'
import VoiceInput from '../components/VoiceInput'
import ActionPanel from '../components/ActionPanel'
import toast from 'react-hot-toast'
import { format, isToday, isYesterday } from 'date-fns'
import { ResponsiveContainer, AreaChart, Area, Tooltip as RTooltip } from 'recharts'

const FALLBACK_COLORS = ['#2DD4BF', '#A78BFA', '#F59E0B', '#F472B6', '#60A5FA', '#34D399']

function txDate(date) {
  const d = new Date(date)
  if (isToday(d))     return format(d, 'HH:mm')
  if (isYesterday(d)) return 'Yesterday'
  return format(d, 'MMM d')
}

function fmtEUR(n, frac = 2) {
  return n.toLocaleString('nl-NL', { minimumFractionDigits: frac, maximumFractionDigits: frac })
}

function getCategoryEmoji(cat) {
  const map = { Groceries: '🛒', Entertainment: '🎬', Transport: '🚆', Shopping: '🛍️', Dining: '🍽️', Income: '💰', Home: '🏠', Other: '💳' }
  return map[cat] || '💳'
}

function accountColor(acc, i) {
  return acc?.color || FALLBACK_COLORS[i % FALLBACK_COLORS.length]
}

export default function Dashboard() {
  const navigate = useNavigate()
  const {
    user, accounts, transactions, cardBlocked,
    goals, spendingPatterns, insights,
    forecast, safeToSpend: sts, balanceSeries,
    getTotalBalance, dispatchAction, sandboxLoaded,
    roundUpPool, theme, setTheme,
  } = useAetherStore()

  const dark = theme !== 'light'

  const [showPanel, setShowPanel]  = useState(false)
  const [pending, setPending]      = useState([])
  const [analysis, setAnalysis]    = useState(null)
  const [analyzing, setAnalyzing]  = useState(false)
  const [activeAcct, setActiveAcct] = useState(0)
  const [liveTranscript, setLiveTranscript] = useState('')

  const total = getTotalBalance()
  const now   = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const monthTx    = useMemo(() => transactions.filter(tx => new Date(tx.date) >= monthStart), [transactions, monthStart])
  const monthIn    = monthTx.filter(tx => tx.amount > 0).reduce((s, tx) => s + tx.amount, 0)
  const monthOut   = monthTx.filter(tx => tx.amount < 0).reduce((s, tx) => s + Math.abs(tx.amount), 0)
  const monthNet   = monthIn - monthOut

  const hour = now.getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const firstName = user?.name?.split(' ')[0] ?? '—'

  const handleVoice = async (text) => {
    setLiveTranscript('')     // transcript → analyzing state
    setAnalyzing(true)
    try {
      const result = await aetherAI.analyzeScene({
        imageBase64: null, voiceText: text,
        financialContext: { user, accounts, transactions, cardBlocked, totalBalance: total, emotionalTone: aetherAI.detectEmotionalTone(text) },
      })
      setAnalysis(result)
      if (result.recommendedActions?.length) { setPending(result.recommendedActions); setShowPanel(true) }
      else toast(result.voiceResponse, { icon: '✦', duration: 4000 })
    } finally { setAnalyzing(false) }
  }

  const handleAction = async (action) => {
    setShowPanel(false)

    // If the user edited a proposed action (e.g. changed the amount), log the
    // correction so the agent can learn the user's preferences over time.
    const original = pending?.find(p => p.type === action.type)
    if (original) {
      const proposedAmt = Number(original.amount ?? original.params?.amount ?? 0)
      const confirmedAmt = Number(action.amount ?? 0)
      const changed =
        (proposedAmt > 0 && Math.abs(confirmedAmt - proposedAmt) / proposedAmt > 0.15) ||
        original.type !== action.type
      if (changed) {
        memoryAPI.learn(
          { type: original.type, amount: proposedAmt },
          { type: action.type, amount: confirmedAmt },
        )
      }
    }

    const res = await dispatchAction(action)
    if (res.success) toast.success(res.result.message)
    else toast.error('Failed: ' + res.error)
  }

  const handleBlockCard = async () => {
    const res = await dispatchAction({
      type: cardBlocked ? 'UNBLOCK_CARD' : 'BLOCK_CARD',
      label: cardBlocked ? 'Unblock card' : 'Freeze card',
    })
    if (res.success) toast.success(res.result.message)
    else toast.error(res.error)
  }

  const handleQuickAction = (key) => {
    switch (key) {
      case 'pay':
        handleVoice('I want to send money to a contact'); break
      case 'request':
        handleVoice('Send a payment request to someone'); break
      case 'move':
        handleVoice('Move money between my accounts'); break
      case 'card':
        handleBlockCard(); break
      case 'save': {
        const sweepAmt = Math.round(roundUpPool?.amount || 0)
        if (sweepAmt > 0 && goals?.[0]) {
          handleAction({ type: 'ROUND_UP_SWEEP', amount: sweepAmt, goalId: goals[0].id, goalLabel: goals[0].name, label: `Sweep €${sweepAmt} → ${goals[0].name}` })
        } else {
          handleVoice('Help me save money toward my goal'); break
        }
        break
      }
      case 'split':
        handleVoice('Split a bill with my friends'); break
      default: break
    }
  }

  const activeAccount = accounts[activeAcct] || accounts[0]
  const activeColor = accountColor(activeAccount, activeAcct)

  // Spending vs typical for trend chip
  const spentRatio = spendingPatterns?.monthly?.average
    ? Math.round((spendingPatterns.monthly.current / spendingPatterns.monthly.average) * 100)
    : null

  const QUICK_ACTIONS = [
    { key: 'pay',     icon: Send,           label: 'Pay'     },
    { key: 'request', icon: ArrowDownLeft,  label: 'Request' },
    { key: 'move',    icon: ArrowLeftRight, label: 'Move'    },
    { key: 'card',    icon: cardBlocked ? Lock : Snowflake, label: cardBlocked ? 'Unfreeze' : 'Freeze' },
    { key: 'save',    icon: PiggyBank,      label: 'Save'    },
    { key: 'split',   icon: Users,          label: 'Split'   },
  ]

  return (
    <div className={`db db--${dark ? 'dark' : 'light'}`}>

      {/* ── Top bar ─────────────────────────────────────────── */}
      <header className="db-topbar">
        <div className="db-topbar-left">
          <div className="db-avatar">{firstName?.[0] || 'A'}</div>
          <div className="db-topbar-text">
            <p className="db-greeting">
              {!sandboxLoaded
                ? <><Loader size={10} className="spin" style={{ marginRight: 4 }} />Syncing</>
                : greeting
              }
              {sandboxLoaded && import.meta.env.VITE_BUNQ_ENV === 'sandbox' && (
                <span className="db-badge-sandbox">SANDBOX</span>
              )}
            </p>
            <h1 className="db-username">{firstName}</h1>
          </div>
        </div>
        <div className="db-topbar-right">
          {insights?.filter(i => i.severity === 'warning').length > 0 && (
            <button className="db-icon-btn db-icon-btn--alert" title="Alerts">
              <Bell size={16} />
              <span className="db-icon-dot" />
            </button>
          )}
          <button className="db-icon-btn" onClick={() => setTheme(dark ? 'light' : 'dark')} aria-label="Toggle theme">
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button className="db-icon-btn" onClick={() => navigate('/settings')} aria-label="Settings">
            <Settings size={16} />
          </button>
        </div>
      </header>

      {/* ── Main grid ───────────────────────────────────────── */}
      <main className="db-main">

        {/* ╔══ HERO STACK ══════════════════════════════════════╗ */}
        <section className="db-hero-stack">

          {/* Hero balance card */}
          <motion.div
            className="db-hero"
            style={{ '--accent': activeColor }}
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}
          >
            <div className="db-hero-bg">
              <span className="db-hero-orb db-hero-orb--1" style={{ background: activeColor }} />
              <span className="db-hero-orb db-hero-orb--2" />
            </div>

            <div className="db-hero-head">
              <div>
                <p className="db-hero-eyebrow">Total balance</p>
                <div className="db-hero-amount">
                  {sandboxLoaded
                    ? <>€<span className="db-hero-amount-num">{fmtEUR(total)}</span></>
                    : <span className="db-hero-loading">€ — — —</span>}
                </div>
                <p className="db-hero-sub">
                  Across {accounts.length} {accounts.length === 1 ? 'account' : 'accounts'}
                  {sandboxLoaded && spentRatio !== null && (
                    <> · <span className={spentRatio <= 100 ? 'pos' : 'neg'}>
                      {spentRatio <= 100 ? <TrendingDown size={11} /> : <TrendingUp size={11} />}
                      {spentRatio}% of typical
                    </span></>
                  )}
                </p>
              </div>

              {sandboxLoaded && balanceSeries?.length > 1 && (
                <div className="db-hero-spark">
                  <ResponsiveContainer width="100%" height={56}>
                    <AreaChart data={balanceSeries} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                      <defs>
                        <linearGradient id="hsg-ac" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={activeColor} stopOpacity={0.45} />
                          <stop offset="100%" stopColor={activeColor} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <Area type="monotone" dataKey="balance" stroke={activeColor} strokeWidth={1.6} fill="url(#hsg-ac)" dot={false} isAnimationActive={false} />
                      <RTooltip cursor={false}
                        contentStyle={{ background: 'rgba(0,0,0,0.85)', border: 'none', borderRadius: 8, fontSize: 11, color: '#fff', padding: '4px 8px' }}
                        formatter={v => [`€${fmtEUR(Number(v))}`, '']}
                        labelFormatter={ts => format(new Date(ts), 'MMM d')} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* Month flow capsule */}
            {sandboxLoaded && (
              <div className="db-hero-flow">
                <div className="db-flow-cell">
                  <ArrowDownLeft size={12} />
                  <div>
                    <span className="db-flow-label">In</span>
                    <span className="db-flow-val">€{fmtEUR(monthIn, 0)}</span>
                  </div>
                </div>
                <span className="db-flow-sep" />
                <div className="db-flow-cell">
                  <ArrowUpRight size={12} />
                  <div>
                    <span className="db-flow-label">Out</span>
                    <span className="db-flow-val">€{fmtEUR(monthOut, 0)}</span>
                  </div>
                </div>
                <span className="db-flow-sep" />
                <div className={`db-flow-cell ${monthNet >= 0 ? 'pos' : 'neg'}`}>
                  {monthNet >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                  <div>
                    <span className="db-flow-label">Net</span>
                    <span className="db-flow-val">{monthNet >= 0 ? '+' : '−'}€{fmtEUR(Math.abs(monthNet), 0)}</span>
                  </div>
                </div>
              </div>
            )}
          </motion.div>

          {/* Account chip swiper — bunq-style */}
          {accounts.length > 0 && (
            <div className="db-acct-swiper" role="tablist" aria-label="Accounts">
              {accounts.map((a, i) => {
                const c = accountColor(a, i)
                const isActive = i === activeAcct
                return (
                  <motion.button
                    key={a.id}
                    role="tab"
                    aria-selected={isActive}
                    className={`db-acct-chip ${isActive ? 'is-active' : ''}`}
                    style={{ '--c': c }}
                    onClick={() => setActiveAcct(i)}
                    whileTap={{ scale: 0.97 }}
                  >
                    <span className="db-acct-chip-dot" />
                    <span className="db-acct-chip-label">{a.label}</span>
                    <span className="db-acct-chip-bal">€{fmtEUR(a.balance, 0)}</span>
                  </motion.button>
                )
              })}
              <button className="db-acct-chip db-acct-chip--add" onClick={() => navigate('/settings')} aria-label="Add account">
                <Plus size={14} />
              </button>
            </div>
          )}

          {/* Quick actions — bunq-style pill row */}
          <div className="db-quick-actions">
            {QUICK_ACTIONS.map(({ key, icon: Icon, label }) => (
              <motion.button
                key={key}
                className={`db-qa ${key === 'card' && cardBlocked ? 'db-qa--frozen' : ''}`}
                onClick={() => handleQuickAction(key)}
                whileTap={{ scale: 0.94 }}
              >
                <span className="db-qa-icon"><Icon size={18} strokeWidth={1.8} /></span>
                <span className="db-qa-label">{label}</span>
              </motion.button>
            ))}
          </div>

          {/* Aether prompt strip */}
          <motion.button
            className="db-aether-strip"
            onClick={() => navigate('/aether')}
            whileTap={{ scale: 0.99 }}
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
          >
            <span className="db-aether-orb">
              <img src="/aether-icon.svg" alt="" width={18} height={18} />
            </span>
            <span className="db-aether-text">
              <span className="db-aether-name">
                Aether
                <span className="db-live-dot" />
              </span>
              <span className="db-aether-status">{analyzing ? 'Thinking…' : 'Ask anything about your money'}</span>
            </span>
            <span className="db-aether-cta">
              <Sparkles size={14} />
              <span>Open</span>
            </span>
          </motion.button>
        </section>

        {/* ╔══ COLUMN B — INSIGHTS + PLANS + SPENDING ══════╗ */}
        <section className="db-col db-col-b">

          {/* Insights */}
          {insights?.length > 0 && (
            <div className="db-card db-section">
              <div className="db-section-head">
                <span className="db-section-title">For you</span>
                <span className="db-section-meta">{insights.length} insight{insights.length !== 1 ? 's' : ''}</span>
              </div>
              <div className="db-insights">
                {insights.slice(0, 4).map((ins, i) => (
                  <motion.button key={ins.id}
                    className={`db-insight db-insight--${ins.severity}`}
                    initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                    onClick={() => { if (ins.action) { setPending([ins.action]); setShowPanel(true) } else toast(ins.body, { icon: ins.icon, duration: 5000 }) }}
                    whileTap={{ scale: 0.99 }}>
                    <span className="db-insight-icon">{ins.icon}</span>
                    <div className="db-insight-body">
                      <span className="db-insight-title">{ins.title}</span>
                      <span className="db-insight-desc">{ins.body}</span>
                    </div>
                    {ins.action && <ChevronRight size={14} className="db-insight-chevron" />}
                  </motion.button>
                ))}
              </div>
            </div>
          )}

          {/* Plans (sub-accounts) */}
          {accounts.length > 0 && (
            <div className="db-card db-section">
              <div className="db-section-head">
                <span className="db-section-title">Plans</span>
                <span className="db-section-meta">€{fmtEUR(total)} · {accounts.length}</span>
              </div>
              <div className="db-plans">
                {accounts.map((a, i) => {
                  const c = accountColor(a, i)
                  const pct = total > 0 ? Math.round((a.balance / total) * 100) : 0
                  return (
                    <motion.div key={a.id}
                      className="db-plan"
                      style={{ '--c': c }}
                      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                    >
                      <div className="db-plan-stripe" />
                      <div className="db-plan-body">
                        <span className="db-plan-label">{a.label}</span>
                        <span className="db-plan-bal">€{fmtEUR(a.balance)}</span>
                      </div>
                      <div className="db-plan-pct">{pct}%</div>
                    </motion.div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Spending breakdown */}
          {spendingPatterns?.monthly?.current > 0 && (
            <div className="db-card db-section">
              <div className="db-section-head">
                <span className="db-section-title">Spending this month</span>
                <span className={`db-trend ${spendingPatterns.monthly.trend <= 0 ? 'down' : 'up'}`}>
                  {spendingPatterns.monthly.trend <= 0 ? <TrendingDown size={11} /> : <TrendingUp size={11} />}
                  {Math.abs(spendingPatterns.monthly.trend || 0)}%
                </span>
              </div>
              <p className="db-spent-total">€{fmtEUR(spendingPatterns.monthly.current, 0)}</p>
              {spendingPatterns.categories?.length > 0 && (
                <div className="db-cats">
                  {spendingPatterns.categories.slice(0, 5).map((c, i) => (
                    <div key={c.name} className="db-cat">
                      <span className="db-cat-emoji">{getCategoryEmoji(c.name)}</span>
                      <span className="db-cat-name">{c.name}</span>
                      <div className="db-cat-bar">
                        <motion.div className="db-cat-fill"
                          initial={{ width: 0 }} animate={{ width: `${c.pct}%` }}
                          transition={{ duration: 0.6, delay: i * 0.05, ease: [0.2, 0.8, 0.2, 1] }} />
                      </div>
                      <span className="db-cat-amt">€{c.amount}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        {/* ╔══ COLUMN C — FORECAST + GOALS + TRANSACTIONS ══╗ */}
        <section className="db-col db-col-c">

          {/* Forecast pair */}
          {sandboxLoaded && sts && forecast && (
            <div className="db-stat-pair">
              <div className="db-card db-stat">
                <p className="db-stat-label">Safe to spend</p>
                <p className="db-stat-val">€{fmtEUR(sts.safe, 0)}</p>
                <p className="db-stat-sub">
                  {sts.upcomingRecurring > 0 ? `€${sts.upcomingRecurring} reserved` : `€${sts.buffer} buffer`}
                </p>
              </div>
              <div className="db-card db-stat">
                <p className="db-stat-label">Month-end forecast</p>
                <p className={`db-stat-val ${forecast.projectedEndBalance < 500 ? 'amber' : ''}`}>
                  €{fmtEUR(forecast.projectedEndBalance, 0)}
                </p>
                <p className="db-stat-sub">{forecast.remainingDays}d · €{forecast.dailyBurn}/day</p>
              </div>
            </div>
          )}

          {/* Goals */}
          {goals?.length > 0 && (
            <div className="db-card db-section">
              <div className="db-section-head">
                <span className="db-section-title">Goals</span>
                <span className="db-section-meta">
                  {goals.filter(g => g.current >= g.target).length}/{goals.length}
                </span>
              </div>
              <div className="db-goals">
                {goals.slice(0, 3).map((g, i) => {
                  const pct = Math.min(100, Math.round((g.current / g.target) * 100))
                  const done = pct >= 100
                  const remaining = Math.max(0, g.target - g.current)
                  return (
                    <div key={g.id} className={`db-goal ${done ? 'is-done' : ''}`}>
                      <div className="db-goal-head">
                        <span className="db-goal-emoji">{g.icon || '🎯'}</span>
                        <div className="db-goal-info">
                          <span className="db-goal-name">{g.name}</span>
                          <span className="db-goal-sub">
                            {done ? '✓ Reached' : `€${remaining.toLocaleString('nl-NL')} to go`}
                          </span>
                        </div>
                        <span className="db-goal-pct">{pct}%</span>
                      </div>
                      <div className="db-goal-track">
                        <motion.div className={`db-goal-fill ${done ? 'done' : ''}`}
                          initial={{ width: 0 }} animate={{ width: `${pct}%` }}
                          transition={{ duration: 0.7, delay: i * 0.07, ease: [0.2, 0.8, 0.2, 1] }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Recent transactions */}
          <div className="db-card db-section db-tx-card">
            <div className="db-section-head">
              <span className="db-section-title">Activity</span>
              {sandboxLoaded && <span className="db-section-meta">{transactions.length} total</span>}
            </div>
            {!sandboxLoaded ? (
              <div className="db-skel-list">{[1,2,3,4,5].map(i => <div key={i} className="db-skel" />)}</div>
            ) : transactions.length === 0 ? (
              <p className="db-empty">No transactions yet</p>
            ) : (
              <div className="db-tx-list">
                {transactions.slice(0, 8).map(tx => (
                  <button key={tx.id} className="db-tx" onClick={() => toast(`${tx.merchant || tx.description} · ${tx.category}`, { icon: getCategoryEmoji(tx.category) })}>
                    <div className="db-tx-icon">
                      <span>{getCategoryEmoji(tx.category)}</span>
                    </div>
                    <div className="db-tx-body">
                      <span className="db-tx-name">{tx.merchant || tx.description || 'Payment'}</span>
                      <span className="db-tx-meta">{tx.category || 'Other'} · {txDate(tx.date)}</span>
                    </div>
                    <span className={`db-tx-amount ${tx.amount > 0 ? 'in' : 'out'}`}>
                      {tx.amount > 0 ? '+' : '−'}€{fmtEUR(Math.abs(tx.amount))}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Voice FAB — visible on all sizes so desktop users can speak too */}
      <div className="db-fab">
        <AnimatePresence>
          {(liveTranscript || analyzing) && (
            <motion.div
              className={`db-fab-bubble ${analyzing ? 'is-thinking' : ''}`}
              initial={{ opacity: 0, y: 6, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 4, scale: 0.98 }}
              transition={{ duration: 0.15 }}
            >
              {analyzing ? (
                <>
                  <Loader size={12} className="spin" />
                  <span>Thinking…</span>
                </>
              ) : (
                <span className="db-fab-bubble-text">{liveTranscript}</span>
              )}
            </motion.div>
          )}
        </AnimatePresence>
        <VoiceInput
          onResult={handleVoice}
          onTranscript={setLiveTranscript}
          compact
        />
      </div>

      <UndoBar />
      <AnimatePresence>
        {showPanel && (
          <ActionPanel actions={pending} analysis={analysis} accounts={accounts} goals={goals}
            onAction={handleAction} onDismiss={() => setShowPanel(false)} />
        )}
      </AnimatePresence>
    </div>
  )
}
