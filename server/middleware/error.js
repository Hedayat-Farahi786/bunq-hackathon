export function errorHandler(err, req, res, next) {
  // Log full error server-side but never leak stack traces to client
  console.error('[ERROR]', err.message, err.stack)

  const status = err.status || err.statusCode || 500

  // Sanitize error message for production
  const message = process.env.NODE_ENV === 'production' && status === 500
    ? 'Internal server error'
    : err.message || 'Internal server error'

  res.status(status).json({ error: message })
}
