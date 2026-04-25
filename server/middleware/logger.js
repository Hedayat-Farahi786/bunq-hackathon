const COLORS = {
  GET:    '\x1b[32m',   // green
  POST:   '\x1b[34m',   // blue
  PUT:    '\x1b[33m',   // yellow
  DELETE: '\x1b[31m',   // red
  RESET:  '\x1b[0m',
  DIM:    '\x1b[2m',
}

export function requestLogger(req, res, next) {
  const start = Date.now()
  const { method, url } = req

  res.on('finish', () => {
    const ms     = Date.now() - start
    const color  = COLORS[method] || COLORS.RESET
    const status = res.statusCode
    const statusColor = status >= 500 ? '\x1b[31m'
      : status >= 400 ? '\x1b[33m'
      : status >= 300 ? '\x1b[36m'
      : '\x1b[32m'

    if (process.env.NODE_ENV !== 'test') {
      console.log(
        `${COLORS.DIM}${new Date().toISOString()}${COLORS.RESET} ` +
        `${color}${method}${COLORS.RESET} ${url} ` +
        `${statusColor}${status}${COLORS.RESET} ${COLORS.DIM}${ms}ms${COLORS.RESET}`
      )
    }
  })
  next()
}
