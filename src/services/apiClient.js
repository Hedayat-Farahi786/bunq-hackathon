/**
 * Secure frontend API client
 *
 * All requests go to /api (proxied to the Express backend by Vite in dev,
 * or by your reverse-proxy/CDN in production).
 *
 * No API keys are ever stored or sent from the browser.
 * The X-Api-Secret header is a lightweight shared secret that prevents
 * other websites from calling your backend proxy.
 */

const API_BASE    = '/api'
const API_SECRET  = import.meta.env.VITE_API_SECRET || 'dev_secret_replace_before_deploying_to_production'

async function request(method, path, body) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Secret': API_SECRET,
    },
  }

  if (body) opts.body = JSON.stringify(body)

  const res = await fetch(`${API_BASE}${path}`, opts)

  if (!res.ok) {
    let msg = `API error ${res.status}`
    try {
      const data = await res.json()
      msg = data.error || msg
    } catch {}
    throw new Error(msg)
  }

  return res.json()
}

export const apiClient = {
  get:    (path)         => request('GET',    path),
  post:   (path, body)   => request('POST',   path, body),
  put:    (path, body)   => request('PUT',    path, body),
  delete: (path)         => request('DELETE', path),

  // Convenience: check if backend is reachable
  health: () => request('GET', '/health'),
}
