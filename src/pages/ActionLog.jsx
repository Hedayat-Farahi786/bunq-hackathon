import React, { useMemo } from 'react'
import { motion } from 'framer-motion'
import { useAetherStore } from '../store/aetherStore'
import {
  CheckCircle2, XCircle, Clock, Undo2,
  ShieldCheck, ArrowLeftRight, CreditCard, Users, AlertTriangle,
  Sparkles, PiggyBank, ArrowRight, RotateCcw,
} from 'lucide-react'
import { format, isToday, isYesterday, differenceInDays } from 'date-fns'
import UndoBar from '../components/UndoBar'

const STATUS_META = {
  completed: { icon: CheckCircle2, label: 'Done',       cls: 'ok'   },
  executing: { icon: Clock,        label: 'Working',    cls: 'wip'  },
  failed:    { icon: XCircle,      label: "Didn't work", cls: 'err' },
  undone:    { icon: Undo2,        label: 'Undone',     cls: 'undone' },
}

const TYPE_META = {
  BLOCK_CARD:      { icon: CreditCard,     label: 'Card frozen',         tone: 'blue'   },
  UNBLOCK_CARD:    { icon: CreditCard,     label: 'Card reactivated',    tone: 'green'  },
  TRANSFER:        { icon: ArrowLeftRight, label: 'Money moved',         tone: 'violet' },
  SAVINGS_BOOST:   { icon: PiggyBank,      label: 'Saved towards a goal',tone: 'green'  },
  ROUND_UP_SWEEP:  { icon: PiggyBank,      label: 'Spare change swept',  tone: 'mint'   },
  GOAL_AUTOPILOT:  { icon: ShieldCheck,    label: 'Goals auto-funded',   tone: 'violet' },
  SET_LIMIT:       { icon: AlertTriangle,  label: 'Spending limit set',  tone: 'amber'  },
  PAYMENT_REQUEST: { icon: Users,          label: 'Split request sent',  tone: 'pink'   },
}

function fmtEUR(n) {
  return Number(n || 0).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function dayLabel(date) {
  const d = new Date(date)
  if (isToday(d))     return 'Today'
  if (isYesterday(d)) return 'Yesterday'
  if (differenceInDays(new Date(), d) < 7) return format(d, 'EEEE')
  return format(d, 'EEE d MMM')
}

export default function ActionLog() {
  const { actionLog, accounts, dispatchAction, dismissAction } = useAetherStore()

  const { groups, stats } = useMemo(() => {
    const groups = new Map()
    let moved = 0
    let blocks = 0
    let saved = 0
    for (const e of actionLog) {
      const key = dayLabel(e.timestamp)
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(e)
      if (e.status === 'completed') {
        if (e.type === 'TRANSFER')       moved  += Number(e.amount || 0)
        if (e.type === 'SAVINGS_BOOST' ||
            e.type === 'ROUND_UP_SWEEP') saved  += Number(e.amount || 0)
        if (e.type === 'BLOCK_CARD')     blocks += 1
      }
    }
    return {
      groups: Array.from(groups.entries()),
      stats: { moved, blocks, saved, total: actionLog.length },
    }
  }, [actionLog])

  return (
    <>
      <div className="logx">
        <header className="logx-header">
          <div className="logx-header-text">
            <p className="logx-eyebrow">Activity</p>
            <h1 className="logx-title">What Aether did</h1>
            <p className="logx-sub">Every action, with full transparency · undo any of them within 10s.</p>
          </div>
          <div className="logx-orb">
            <Sparkles size={18} />
          </div>
        </header>

        {stats.total > 0 && (
          <div className="logx-stats">
            <div className="logx-stat">
              <span className="logx-stat-label">Total</span>
              <span className="logx-stat-value">{stats.total}</span>
              <span className="logx-stat-hint">actions</span>
            </div>
            <div className="logx-stat">
              <span className="logx-stat-label">Moved</span>
              <span className="logx-stat-value">€{fmtEUR(stats.moved)}</span>
              <span className="logx-stat-hint">safely</span>
            </div>
            <div className="logx-stat">
              <span className="logx-stat-label">Saved</span>
              <span className="logx-stat-value">€{fmtEUR(stats.saved)}</span>
              <span className="logx-stat-hint">toward goals</span>
            </div>
            <div className="logx-stat">
              <span className="logx-stat-label">Protected</span>
              <span className="logx-stat-value">{stats.blocks}×</span>
              <span className="logx-stat-hint">card freezes</span>
            </div>
          </div>
        )}

        {actionLog.length === 0 ? (
          <div className="logx-empty">
            <div className="logx-empty-orb">
              <Sparkles size={22} />
            </div>
            <h3 className="logx-empty-title">Nothing here yet</h3>
            <p className="logx-empty-desc">
              When Aether acts on your behalf — splitting a bill, moving cash, freezing your card — you'll see the full story here.
            </p>
          </div>
        ) : (
          <div className="logx-timeline">
            {groups.map(([day, entries], gi) => (
              <section key={day} className="logx-group">
                <div className="logx-daychip">{day}</div>

                {entries.map((entry, i) => {
                  const sMeta = STATUS_META[entry.status] || STATUS_META.executing
                  const tMeta = TYPE_META[entry.type] || { icon: ShieldCheck, label: entry.type, tone: 'violet' }
                  const StatusIcon = sMeta.icon
                  const TypeIcon   = tMeta.icon
                  const snap = entry.snapshot

                  const impact = snap && entry.status === 'completed'
                    ? snap.accounts
                        ?.map(sAcc => {
                          const curr = accounts.find(a => a.id === sAcc.id)
                          if (!curr || sAcc.balance === curr.balance) return null
                          return { ...sAcc, now: curr.balance, delta: curr.balance - sAcc.balance }
                        })
                        .filter(Boolean)
                    : null

                  return (
                    <motion.article
                      key={entry.id}
                      className={`logx-card is-${sMeta.cls}`}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: (gi * entries.length + i) * 0.03 }}
                    >
                      <div className={`logx-icon tone-${tMeta.tone}`}>
                        <TypeIcon size={16} strokeWidth={1.8} />
                      </div>

                      <div className="logx-body">
                        <div className="logx-row-top">
                          <div className="logx-row-title-wrap">
                            <h4 className="logx-row-title">{tMeta.label}</h4>
                            <time className="logx-row-time">
                              {format(new Date(entry.timestamp), 'HH:mm')}
                            </time>
                          </div>
                          <div className={`logx-status status-${sMeta.cls}`}>
                            <StatusIcon size={11} strokeWidth={2.2} />
                            <span>{sMeta.label}</span>
                          </div>
                        </div>

                        {entry.result?.message && (
                          <p className="logx-msg">{entry.result.message}</p>
                        )}
                        {entry.error && (
                          <p className="logx-err">{entry.error}</p>
                        )}
                        {entry.warning && (
                          <p className={`logx-warning logx-warning--${entry.warning.kind}`}>
                            <AlertTriangle size={11} strokeWidth={2.2} />
                            {entry.warning.message}
                          </p>
                        )}

                        {entry.status === 'executing' && entry.hydrated && (
                          <button
                            className="logx-retry-btn"
                            onClick={() => { dismissAction(entry.id); dispatchAction(entry) }}
                          >
                            <RotateCcw size={11} />
                            Retry
                          </button>
                        )}

                        {impact && impact.length > 0 && (
                          <div className="logx-impact">
                            {impact.map(imp => (
                              <div key={imp.id} className="logx-impact-row">
                                <span className="logx-impact-name">{imp.label}</span>
                                <span className="logx-impact-flow">
                                  €{imp.balance.toFixed(2)}
                                  <ArrowRight size={11} className="logx-impact-arrow" />
                                  €{imp.now.toFixed(2)}
                                </span>
                                <span className={`logx-impact-delta ${imp.delta > 0 ? 'pos' : 'neg'}`}>
                                  {imp.delta > 0 ? '+' : ''}€{imp.delta.toFixed(2)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </motion.article>
                  )
                })}
              </section>
            ))}
          </div>
        )}

        <div className="spacer" />
      </div>

      <UndoBar />
    </>
  )
}
