import express from 'express'
import { createServer } from 'http'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { aiRouter } from './routes/ai.js'
import { bunqRouter } from './routes/bunq.js'
import { healthRouter } from './routes/health.js'
import { memoryRouter } from './routes/memory.js'
import { requestLogger } from './middleware/logger.js'
import { validateApiSecret } from './middleware/auth.js'
import { errorHandler } from './middleware/error.js'
import { initDB, DB_MODE } from './db/index.js'
import { runMigrations } from './db/migrate.js'
import { pruneExpired } from './services/cache.js'

const app  = express()
const PORT = process.env.PORT || 3001

// ── Security headers ─────────────────────────────────────────
app.use(helmet({
  crossOriginEmbedderPolicy: false, // needed for camera access in frontend
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      connectSrc:  ["'self'", 'https://api.anthropic.com', 'https://generativelanguage.googleapis.com', 'https://api.elevenlabs.io', process.env.OLLAMA_BASE_URL || 'http://localhost:11434'],
      imgSrc:      ["'self'", 'data:', 'blob:'],
      mediaSrc:    ["'self'", 'blob:'],
    },
  },
}))

// ── CORS ─────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
  .split(',').map(o => o.trim())

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (curl, Postman, same-origin)
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true)
    cb(new Error(`CORS: origin ${origin} not allowed`))
  },
  methods:     ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Api-Secret', 'Authorization'],
  credentials: true,
  maxAge:      86400,
}))

// ── Body parsing ─────────────────────────────────────────────
app.use(express.json({ limit: '4mb' })) // 4 MB for base64 camera frames
app.use(express.urlencoded({ extended: false }))

// ── Trust proxy (behind CloudFront / ALB) ─────────────────────
app.set('trust proxy', 1)

// ── Global rate limiting ──────────────────────────────────────
app.use(rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max:      120,        // 120 req/min per IP
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many requests — please slow down.' },
}))

// ── AI-specific tighter rate limit ──────────────────────────
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max:      30,
  message: { error: 'AI rate limit exceeded — max 30 requests per minute.' },
})

// ── Logging ───────────────────────────────────────────────────
app.use(requestLogger)

// ── Routes ───────────────────────────────────────────────────
app.use('/api/health', healthRouter)
app.use('/api/ai',     aiLimiter, validateApiSecret, aiRouter)
app.use('/api/bunq',   validateApiSecret, bunqRouter)
app.use('/api/memory', validateApiSecret, memoryRouter)

// ── 404 ───────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Not found' }))

// ── Error handler ─────────────────────────────────────────────
app.use(errorHandler)

// ── Start ─────────────────────────────────────────────────────
const server = createServer(app)

// Initialise DB + run migrations before opening the port. If the DB can't be
// reached, we still boot — the AI route degrades gracefully (cache/memory skipped).
let cachePruneTimer = null
async function boot() {
  try {
    await initDB()
    const res = await runMigrations()
    console.log(`[db] mode=${DB_MODE} · migrations=${res.applied} applied`)

  } catch (err) {
    console.warn(`[db] init failed: ${err.message}`)
    console.warn('[db] server will run without persistent memory/cache')
  }

  // Periodic cache GC — every 10 min.
  cachePruneTimer = setInterval(() => {
    pruneExpired().then(n => {
      if (n > 0 && process.env.DEBUG_CACHE) console.log(`[cache] pruned ${n} expired rows`)
    }).catch(() => {})
  }, 10 * 60 * 1000).unref?.()

  server.listen(PORT, () => {
    console.log(`\n🚀 bunq Aether backend running`)
    console.log(`   http://localhost:${PORT}`)
    console.log(`   AI provider: ${process.env.DEFAULT_AI_PROVIDER || 'claude'}`)
    console.log(`   DB mode:     ${DB_MODE}`)
    console.log(`   Env: ${process.env.NODE_ENV || 'development'}\n`)
  })
}

boot().catch(err => {
  console.error('[boot] fatal:', err)
  process.exit(1)
})

// Graceful shutdown
function shutdown() {
  if (cachePruneTimer) clearInterval(cachePruneTimer)
  server.close(() => process.exit(0))
}
process.on('SIGTERM', shutdown)
process.on('SIGINT',  shutdown)
