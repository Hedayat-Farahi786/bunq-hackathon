/**
 * Thin wrapper for /api/memory endpoints.
 *
 * Every call is fire-and-forget from the UI's perspective — if the server
 * is down or the DB is unreachable, the UI doesn't block. We just log and move on.
 */

import { apiClient } from './apiClient.js'

function safe(fn) {
  return async (...args) => {
    try { return await fn(...args) }
    catch (err) {
      if (import.meta.env.DEV) console.warn('[memoryAPI]', err.message)
      return null
    }
  }
}

export const memoryAPI = {
  logAction: safe((entry) => apiClient.post('/memory/actions', entry)),
  getActions: safe((limit = 50) => apiClient.get(`/memory/actions?limit=${limit}`)),
  setTrait:  safe((key, value, confidenceDelta) => apiClient.post('/memory/traits', { key, value, confidenceDelta })),
  rememberMerchant: safe((patch) => apiClient.post('/memory/merchants', patch)),
  learn: safe((proposed, confirmed) => apiClient.post('/memory/learn', { proposed, confirmed })),
  getConversations: safe((limit = 10) => apiClient.get(`/memory/conversations?limit=${limit}`)),
  getStats: safe(() => apiClient.get('/memory/stats')),
}
