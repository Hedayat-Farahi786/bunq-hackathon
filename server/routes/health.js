import { Router } from 'express'
import { getProviderStatus } from '../providers/index.js'
import { DB_MODE, getDB } from '../db/index.js'
import { getCacheStats } from '../services/cache.js'
import { getMemoryStats } from '../services/memory.js'

export const healthRouter = Router()

healthRouter.get('/', async (req, res) => {
  const providers = await getProviderStatus()
  const bunqKey = process.env.BUNQ_API_KEY || ''

  let dbStatus = { mode: DB_MODE, connected: false, error: null }
  let memoryStats = null
  try {
    const db = getDB()
    await db.one('SELECT 1 AS ok')
    dbStatus.connected = true
    memoryStats = await getMemoryStats(process.env.BUNQ_USER_ID || 'single-user')
  } catch (err) {
    dbStatus.error = err.message
  }

  res.json({
    status:    'ok',
    uptime:    process.uptime(),
    env:       process.env.NODE_ENV,
    providers,
    bunq: {
      connected: !!(bunqKey && !bunqKey.startsWith('your_') && !bunqKey.startsWith('REPLACE_')),
      sandbox:   bunqKey.startsWith('sandbox_'),
      userId:    process.env.BUNQ_USER_ID || null,
    },
    db:     dbStatus,
    cache:  getCacheStats(),
    memory: memoryStats,
    timestamp: new Date().toISOString(),
  })
})
