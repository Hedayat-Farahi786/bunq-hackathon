/**
 * bunq API Service Layer — routes all calls through the Express backend proxy.
 * The backend holds the session token; the browser never sees it.
 */

import { apiClient } from './apiClient.js'

// Set by the store after initialization (from env / OAuth flow)
const USER_ID    = import.meta.env.VITE_BUNQ_USER_ID    || '3626159'
const ACCOUNT_ID = import.meta.env.VITE_BUNQ_ACCOUNT_ID || '3616391'

export const bunqAPI = {
  // ── Accounts ─────────────────────────────────────────────────
  getAccounts: (userId = USER_ID) =>
    apiClient.get(`/bunq/accounts/${userId}`),

  // ── Cards ────────────────────────────────────────────────────
  getCards: (userId = USER_ID) =>
    apiClient.get(`/bunq/cards/${userId}`),

  blockCard: (userId = USER_ID, cardId) =>
    apiClient.put(`/bunq/cards/${userId}/${cardId}/block`),

  unblockCard: (userId = USER_ID, cardId) =>
    apiClient.put(`/bunq/cards/${userId}/${cardId}/unblock`),

  // ── Payments ─────────────────────────────────────────────────
  transfer: (userId = USER_ID, accountId = ACCOUNT_ID, toIban, amount, description = 'Aether Transfer') =>
    apiClient.post(`/bunq/payments/${userId}/${accountId}/transfer`, { toIban, amount, description }),

  // ── Payment Requests (splits) ─────────────────────────────────
  sendPaymentRequest: (userId = USER_ID, accountId = ACCOUNT_ID, contactAlias, amount, description) =>
    apiClient.post(`/bunq/requests/${userId}/${accountId}/send`, { contactAlias, amount, description }),

  sendBulkPaymentRequest: (userId = USER_ID, accountId = ACCOUNT_ID, contacts, amounts, description) =>
    Promise.all(contacts.map((c, i) =>
      bunqAPI.sendPaymentRequest(userId, accountId, c.alias, amounts[i], description)
    )),

  // ── Transactions ─────────────────────────────────────────────
  getTransactions: (userId = USER_ID, accountId = ACCOUNT_ID, count = 50) =>
    apiClient.get(`/bunq/transactions/${userId}/${accountId}?count=${count}`),

  // ── OAuth ────────────────────────────────────────────────────
  getOAuthUrl: (clientId, redirectUri) =>
    `https://oauth.bunq.com/auth?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${crypto.randomUUID()}`,

  exchangeCode: (code, redirectUri) =>
    apiClient.post('/bunq/oauth/token', { code, redirectUri }),
}
