import React from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useAetherStore } from '../store/aetherStore'
import { Loader } from 'lucide-react'

export default function ActionToast() {
  const { actionLog } = useAetherStore()
  const live = actionLog.find(a => a.status === 'executing' && !a.hydrated)

  return (
    <AnimatePresence>
      {live && (
        <motion.div
          className="executing-chip"
          initial={{ opacity: 0, y: -12, scale: 0.92 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -12, scale: 0.92 }}
          transition={{ duration: 0.18 }}
        >
          <Loader size={13} className="spin" />
          {live.label || live.description || 'Executing action…'}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
