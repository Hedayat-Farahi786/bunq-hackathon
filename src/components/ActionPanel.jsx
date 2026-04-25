import React, { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Loader, Check, Edit3, Lock, Unlock, TrendingUp, Target, Shield, Users } from 'lucide-react'
import { useAetherStore } from '../store/aetherStore'

const TYPE_META = {
  BLOCK_CARD:      { icon: Lock,       verb: 'Freeze card'         },
  UNBLOCK_CARD:    { icon: Unlock,     verb: 'Unfreeze card'       },
  TRANSFER:        { icon: TrendingUp, verb: 'Move money'          },
  SAVINGS_BOOST:   { icon: Target,     verb: 'Save it'             },
  SET_LIMIT:       { icon: Shield,     verb: 'Set limit'           },
  PAYMENT_REQUEST: { icon: Users,      verb: 'Send split request'  },
  ROUND_UP_SWEEP:  { icon: Target,     verb: 'Sweep round-ups'     },
  GOAL_AUTOPILOT:  { icon: Target,     verb: 'Split across goals'  },
}

export default function ActionPanel({ actions, accounts = [], goals = [], onAction, onDismiss }) {
  const { contacts: storeContacts } = useAetherStore()
  const [executing, setExecuting] = useState(null)
  const [selected, setSelected]   = useState([])
  const [confirmStep, setConfirm] = useState(null)
  const [editing, setEditing]     = useState(null)

  const [overrides, setOverrides] = useState(() =>
    Object.fromEntries(actions.map((a, i) => {
      let amount = Number(a.params?.amount ?? a.amount ?? 0) || 0
      // For splits, ensure amount is the TOTAL, not perPerson
      if (a.type === 'PAYMENT_REQUEST' && a.params?.perPerson) {
        const pp = Number(a.params.perPerson)
        const np = Number(a.params.numPeople || 2)
        const total = pp * np
        if (total > amount) amount = total
      }
      return [i, {
        amount,
        fromAccount: a.params?.fromAccount ?? accounts[0]?.id ?? null,
        toAccount:   a.params?.toAccount   ?? null,
        toLabel:     a.params?.toLabel     ?? a.params?.goalLabel ?? null,
      }]
    }))
  )

  const contactList = useMemo(() => storeContacts?.length ? storeContacts : [
    { id: 'c1', name: 'Sophie',  alias: 'sophie@bunq.me'  },
    { id: 'c2', name: 'Martijn', alias: 'martijn@bunq.me' },
    { id: 'c3', name: 'Emma',    alias: 'emma@bunq.me'    },
    { id: 'c4', name: 'Lucas',   alias: 'lucas@bunq.me'   },
  ], [storeContacts])

  const patchOverride = (idx, patch) =>
    setOverrides(prev => ({ ...prev, [idx]: { ...prev[idx], ...patch } }))

  const execute = async (action, idx) => {
    if ((action.type === 'BLOCK_CARD' || action.urgency === 'HIGH') && confirmStep !== action.type) {
      setConfirm(action.type)
      return
    }
    setExecuting(action.type)
    setConfirm(null)
    const o = overrides[idx] || {}
    const enriched = {
      ...action, ...(action.params || {}),
      amount:      o.amount || action.params?.amount || 0,
      fromAccount: o.fromAccount || action.params?.fromAccount,
      toAccount:   o.toAccount   || action.params?.toAccount,
      toLabel:     o.toLabel     || action.params?.toLabel || action.params?.goalLabel,
    }
    if (action.type === 'PAYMENT_REQUEST' && selected.length > 0) {
      enriched.contacts = selected
      // Send the TOTAL amount — the store divides per contact
      enriched.amount = o.amount > 0 ? o.amount : Number(action.params?.amount || 0)
      enriched.perPerson = enriched.amount / (selected.length + 1)
    }
    await onAction(enriched)
    setExecuting(null)
  }

  return (
    <motion.div
      className="ap-backdrop"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onDismiss}
    >
      <motion.div
        className="ap-sheet"
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 320 }}
        onClick={e => e.stopPropagation()}
      >
        <div className="ap-handle" />

        <div className="ap-header">
          <div>
            <h2 className="ap-title">What would you like to do?</h2>
            <p className="ap-sub">Nothing happens until you confirm</p>
          </div>
          <button className="ap-close" onClick={onDismiss}><X size={14} /></button>
        </div>

        <div className="ap-list">
          {actions.map((action, i) => {
            const meta   = TYPE_META[action.type] || { icon: Shield, verb: 'Do it' }
            const Icon   = meta.icon
            const isExec = executing === action.type
            const isConf = confirmStep === action.type
            const isSplit = action.type === 'PAYMENT_REQUEST'
            const isMoney = action.type === 'TRANSFER' || action.type === 'SAVINGS_BOOST'
            const o = overrides[i] || {}
            const isEditing = editing === i
            const fromAcc = accounts.find(a => a.id === o.fromAccount) || accounts[0]
            const toAcc   = accounts.find(a => a.id === o.toAccount) ||
                            accounts.find(a => a.label?.toLowerCase() === String(o.toLabel || '').toLowerCase())

            return (
              <motion.div
                key={`${action.type}-${i}`}
                className="ap-item"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
              >
                {/* Row: icon + text + edit toggle */}
                <div className="ap-item-row">
                  <div className="ap-icon"><Icon size={16} /></div>
                  <div className="ap-item-body">
                    <div className="ap-item-title">{action.label}</div>
                  </div>
                  {isMoney && (
                    <button className="ap-edit-btn" onClick={() => setEditing(isEditing ? null : i)}>
                      {isEditing ? <Check size={13} /> : <Edit3 size={13} />}
                    </button>
                  )}
                </div>

                {/* Money preview */}
                {!isEditing && isMoney && (o.amount > 0 || fromAcc) && (
                  <div className="ap-preview">
                    {o.amount > 0 && <span className="ap-preview-amount">€{Number(o.amount).toFixed(2)}</span>}
                    {fromAcc && <span className="ap-preview-detail">{fromAcc.label}</span>}
                    {(toAcc || o.toLabel) && <><span className="ap-preview-arrow">→</span><span className="ap-preview-detail">{toAcc?.label || o.toLabel}</span></>}
                  </div>
                )}

                {/* Edit panel */}
                <AnimatePresence>
                  {isEditing && isMoney && (
                    <motion.div className="ap-edit" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                      <div className="ap-field">
                        <label>Amount</label>
                        <div className="ap-amount-wrap">
                          <span>€</span>
                          <input type="number" min="0" step="1" value={o.amount || ''} onChange={e => patchOverride(i, { amount: Number(e.target.value) || 0 })} />
                        </div>
                      </div>
                      {accounts.length > 1 && (
                        <div className="ap-field">
                          <label>From</label>
                          <select value={o.fromAccount || ''} onChange={e => patchOverride(i, { fromAccount: e.target.value })}>
                            {accounts.map(a => <option key={a.id} value={a.id}>{a.label} · €{a.balance.toFixed(2)}</option>)}
                          </select>
                        </div>
                      )}
                      {accounts.length > 1 && (
                        <div className="ap-field">
                          <label>To</label>
                          <select value={o.toAccount || toAcc?.id || ''} onChange={e => patchOverride(i, { toAccount: e.target.value, toLabel: null })}>
                            <option value="">— pick account —</option>
                            {accounts.filter(a => a.id !== o.fromAccount).map(a => <option key={a.id} value={a.id}>{a.label} · €{a.balance.toFixed(2)}</option>)}
                          </select>
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Split contacts */}
                {isSplit && (
                  <div className="ap-contacts">
                    <p className="ap-contacts-label">Split with</p>
                    <div className="ap-contacts-row">
                      {contactList.map(c => (
                        <button
                          key={c.id}
                          className={`ap-contact ${selected.includes(c) ? 'on' : ''}`}
                          onClick={() => setSelected(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c])}
                        >
                          <span className="ap-contact-av">{c.name[0]}</span>
                          {c.name}
                        </button>
                      ))}
                    </div>
                    {selected.length > 0 && o.amount > 0 && (
                      <div className="ap-split-result">
                        <span>€{o.amount.toFixed(2)} total · €{(o.amount / (selected.length + 1)).toFixed(2)} each</span>
                        <span className="ap-split-sub">you + {selected.length} other{selected.length !== 1 ? 's' : ''}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Confirm nudge */}
                <AnimatePresence>
                  {isConf && (
                    <motion.p className="ap-confirm-nudge" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                      Tap again to confirm
                    </motion.p>
                  )}
                </AnimatePresence>

                <motion.button
                  className={`ap-btn ${isConf ? 'confirm' : ''} ${isExec ? 'loading' : ''}`}
                  onClick={() => execute(action, i)}
                  disabled={!!executing || (isSplit && selected.length === 0)}
                  whileTap={{ scale: 0.98 }}
                >
                  {isExec ? <><Loader size={13} className="spin" /> Working…</> : isConf ? `Yes, ${meta.verb.toLowerCase()}` : meta.verb}
                </motion.button>
              </motion.div>
            )
          })}
        </div>

        <button className="ap-dismiss" onClick={onDismiss}>Not now</button>
      </motion.div>
    </motion.div>
  )
}
