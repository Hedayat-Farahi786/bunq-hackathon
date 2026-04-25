/**
 * Validates that requests to protected routes come from our own frontend.
 * The frontend sends X-Api-Secret header which must match the server's
 * API_SECRET env var. This prevents other origins from abusing the proxy
 * even if they somehow bypass CORS (e.g. server-to-server calls).
 */
export function validateApiSecret(req, res, next) {
  const secret = process.env.API_SECRET
  if (!secret || secret === 'dev_secret_replace_before_deploying_to_production') {
    // In development with the placeholder, allow all — warn loudly
    if (process.env.NODE_ENV !== 'production') {
      return next()
    }
  }

  const provided = req.headers['x-api-secret']
  if (!provided || provided !== secret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
}
