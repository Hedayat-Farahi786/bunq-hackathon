import React, { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { RotateCcw, X, Check } from 'lucide-react'
import { useAetherStore } from '../store/aetherStore'
import toast from 'react-hot-toast'

const TYPE_LABELS = {
  BLOCK_CARD:      'Card frozen',
  UNBLOCK_CARD:    'Card unfrozen',
  TRANSFER:        'Money moved',
  SAVINGS_BOOST:   'Saved to goal',
  PAYMENT_REQUEST: 'Split request sent',
  ROUND_UP_SWEEP:  'Round-ups swept',
  GOAL_AUTOPILOT:  'Split across goals',
  SET_LIMIT:       'Limit set',
}

export default function UndoBar() {
  const { pendingUndo, undoLastAction, clearUndo, actionLog } = useAetherStore()
  const [timeLeft, setTimeLeft] = useState(10)

  useEffect(() => {
    if (!pendingUndo) return
    setTimeLeft(10)
    const id = setInterval(() => {
      const remaining = Math.ceil((pendingUndo.expiresAt - Date.now()) / 1000)
      setTimeLeft(remaining)
      if (remaining <= 0) { clearUndo(); clearInterval(id) }
    }, 200)
    return () => clearInterval(id)
  }, [pendingUndo])

  const handleUndo = async () => {
    await undoLastAction()
    toast.success('Action reversed')
  }

  const entry = pendingUndo
    ? actionLog.find(a => a.id === pendingUndo.entryId)
    : null

  // Title: use type label, fallback to entry label, fallback to generic
  const title = TYPE_LABELS[entry?.type] || entry?.label || 'Done'
  // Detail: the result message from the store (always accurate)
  const detail = entry?.result?.message

  return (
    <AnimatePresence>
      {pendingUndo && timeLeft > 0 && (
        <motion.div
          className="undo-bar"
          initial={{ opacity: 0, y: -12, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.97 }}
          transition={{ type: 'spring', damping: 28, stiffness: 320 }}
        >
          {/* Timer bar at bottom */}
          <div className="undo-timer-track">
            <div className="undo-timer-fill" style={{ '--pct': `${(timeLeft / 10) * 100}%` }} />
          </div>

          <div className="undo-body">
            <div className="undo-icon"><Check size={13} /></div>
            <div className="undo-text">
              <div className="undo-label">{title}</div>
              {detail && <div className="undo-detail">{detail}</div>}
            </div>
            <div className="undo-actions-row">
              <button className="btn-undo" onClick={handleUndo}>
                <RotateCcw size={11} />
                Undo · {timeLeft}s
              </button>
              <button className="btn-undo-x" onClick={clearUndo} aria-label="Dismiss">
                <X size={11} />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
