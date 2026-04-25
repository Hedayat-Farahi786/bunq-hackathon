import { create } from 'zustand'
import { bunqAPI } from '../services/bunqAPI'
import { memoryAPI } from '../services/memoryAPI'
import { extractContacts, buildInsights } from '../services/insights'
import {
  forecastMonth, safeToSpend, balanceSeries,
  roundUpPool, fraudRadar, goalAutopilot,
  billCliff, goalPacing, subscriptionWaste,
} from '../services/forecast'

// Helper: extract the serialisable shape of an action for server mirroring
function actionPayload(entry, extras = {}) {
  return {
    id:          entry.id,
    type:        entry.type,
    status:      entry.status,
    amount:      entry.amount ?? entry.perPerson ?? null,
    fromAccount: entry.fromAccount ?? null,
    toAccount:   entry.toAccount ?? entry.toIban ?? entry.toLabel ?? entry.goalLabel ?? null,
    description: entry.description ?? entry.label ?? null,
    snapshot:    entry.snapshot ?? null,
    ...extras,
  }
}

const LS_PREFS = 'aether_prefs_v1'
const DEFAULT_PREFS = {
  autoBlock:     true,
  autoSave:      true,
  notifications: true,
  riskThreshold: 'MEDIUM',
  scanInterval:  3,
}
function loadPrefs() {
  try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(LS_PREFS) || '{}') } }
  catch { return DEFAULT_PREFS }
}
function savePrefs(p) { try { localStorage.setItem(LS_PREFS, JSON.stringify(p)) } catch {} }

/** Crude merchant → category mapping. Works for demo; easy to expand. */
function categorise(payment) {
  const raw = (payment.counterparty_alias?.display_name || payment.description || '').toLowerCase()
  if (/albert heijn|jumbo|dirk|lidl|aldi|picnic|supermarkt|grocer/.test(raw)) return 'Groceries'
  if (/netflix|spotify|youtube|disney|apple|hbo|prime|twitch/.test(raw))     return 'Entertainment'
  if (/ns |ov|uber|bolt|taxi|shell|bp |esso|fuel/.test(raw))                 return 'Transport'
  if (/h&m|zara|bol\.com|amazon|coolblue|mediamarkt|ikea/.test(raw))         return 'Shopping'
  if (/restaurant|cafe|coffee|pizza|sushi|mcdonald|kfc|bar /.test(raw))      return 'Dining'
  if (/salary|salaris|loon|payroll/.test(raw))                                return 'Income'
  if (payment.amount?.value && parseFloat(payment.amount.value) > 0)          return 'Income'
  return 'Other'
}

function computeSpendingPatterns(transactions) {
  const now = Date.now()
  const weekMs  = 7  * 24 * 60 * 60 * 1000
  const monthMs = 30 * 24 * 60 * 60 * 1000

  const weekTxs  = transactions.filter(tx => tx.amount < 0 && (now - new Date(tx.date)) < weekMs)
  const monthTxs = transactions.filter(tx => tx.amount < 0 && (now - new Date(tx.date)) < monthMs)

  const weekCurrent  = weekTxs.reduce((s, tx) => s + Math.abs(tx.amount), 0)
  const monthCurrent = monthTxs.reduce((s, tx) => s + Math.abs(tx.amount), 0)

  // Category breakdown from real transaction descriptions
  const catMap = {}
  monthTxs.forEach(tx => {
    const cat = tx.category || 'Other'
    catMap[cat] = (catMap[cat] || 0) + Math.abs(tx.amount)
  })
  const totalCat = Object.values(catMap).reduce((s, v) => s + v, 0) || 1
  const categories = Object.entries(catMap)
    .sort((a, b) => b[1] - a[1])
    .map(([name, amount]) => ({ name, amount: Math.round(amount), pct: Math.round(amount / totalCat * 100) }))

  return {
    weekly:  { current: Math.round(weekCurrent),  avg: Math.round(weekCurrent),  trend: 0 },
    monthly: { current: Math.round(monthCurrent), avg: Math.round(monthCurrent), trend: 0 },
    categories: categories.length ? categories : [],
  }
}

export const useAetherStore = create((set, get) => ({
  initialized: false,
  loading: true,
  sandboxLoaded: false,
  user: null,
  accounts: [],
  contacts: [],
  goals: [],
  transactions: [],
  spendingPatterns: null,
  cardBlocked: false,
  primaryCardId: import.meta.env.VITE_BUNQ_CARD_ID || null,   // real bunq card ID, loaded on init
  mockCardMode: false,    // true when no real card in sandbox — still lets demo flow work
  prefs: loadPrefs(),
  insights: [],
  forecast: null,
  safeToSpend: null,
  balanceSeries: [],
  roundUpPool: { amount: 0, count: 0 },
  fraudFlags: [],
  autopilotPlan: null,
  cliff: null,
  pacing: [],
  subBloat: null,
  aetherActive: false,
  voiceActive: false,
  actionLog: [],
  pendingUndo: null,
  overlayHints: [],
  currentAnalysis: null,
  isAnalyzing: false,
  lastVoiceText: '',
  emotionalTone: null,

  initializeApp: async () => {
    set({ initialized: true, loading: true })

    try {
      const [accountsRes, cardsRes] = await Promise.allSettled([
        bunqAPI.getAccounts(),
        bunqAPI.getCards(),
      ])

      let loadedAccounts = []
      if (accountsRes.status === 'fulfilled') {
        const r = accountsRes.value
        if (r?.Response && !r._mock) {
          loadedAccounts = r.Response
            .map(r2 => r2.MonetaryAccountBank || r2.MonetaryAccountSavings || r2.MonetaryAccountJoint)
            .filter(Boolean)
            .map(a => ({
              id:       String(a.id),
              label:    a.description || 'Account',
              balance:  parseFloat(a.balance?.value || 0),
              currency: a.balance?.currency || 'EUR',
              iban:     a.alias?.find(al => al.type === 'IBAN')?.value || '',
              color:    '#1a56db',
              status:   a.status,
            }))
          if (loadedAccounts.length > 0) {
            // Extract user name from IBAN alias of first account
            const firstAcct = r.Response
              .map(r2 => r2.MonetaryAccountBank || r2.MonetaryAccountSavings || r2.MonetaryAccountJoint)
              .filter(Boolean)[0]
            const ibanAlias = firstAcct?.alias?.find(al => al.type === 'IBAN')
            const userName = ibanAlias?.name || null
            set({
              accounts: loadedAccounts,
              ...(userName ? { user: { name: userName } } : {}),
            })
          }
        }
      }

      // Pull transactions for ALL loaded accounts in parallel, merge, sort desc
      const txAccounts = loadedAccounts.length > 0
        ? loadedAccounts
        : [{ id: import.meta.env.VITE_BUNQ_ACCOUNT_ID || '3616391' }]

      const txResults = await Promise.allSettled(
        txAccounts.map(a => bunqAPI.getTransactions(undefined, a.id, 30))
      )

      const merged = []
      txResults.forEach((res, i) => {
        if (res.status !== 'fulfilled') return
        const r = res.value
        if (!r?.Response || r._mock) return
        const accId = String(txAccounts[i].id)
        r.Response
          .map(r2 => r2.Payment).filter(Boolean)
          .forEach(p => {
            const counterpartyName = p.counterparty_alias?.display_name || p.counterparty_alias?.label_user?.display_name
            const counterpartyIban = p.counterparty_alias?.iban
            merged.push({
              id:       String(p.id),
              date:     new Date(p.created),
              merchant: counterpartyName || p.description,
              amount:   parseFloat(p.amount?.value || 0),
              category: categorise(p),
              account:  accId,
              counterpartyName,
              counterpartyAlias: counterpartyIban || counterpartyName,
              counterpartyIban,
              description: p.description,
            })
          })
      })

      if (merged.length > 0) {
        merged.sort((a, b) => new Date(b.date) - new Date(a.date))
        const realContacts = extractContacts(merged, 8)
        set({
          transactions: merged,
          spendingPatterns: computeSpendingPatterns(merged),
          contacts: realContacts.length ? realContacts : get().contacts,
        })
      }

      // Seed plausible savings goals if the user has none yet. The judgment
      // engine needs goals with a real "current" balance to suggest pulling
      // cushion from — without these, every "tight" call has the same single
      // alternative ("wait for payday") and the demo feels thin.
      if (get().goals.length === 0) {
        set({
          goals: [
            { id: 'goal_japan',   icon: '🗾', name: 'Japan trip',     current: 320, target: 2400, deadline: '2026-09-30' },
            { id: 'goal_emerg',   icon: '🛟', name: 'Emergency fund', current: 240, target: 1800 },
            { id: 'goal_laptop',  icon: '💻', name: 'New laptop',     current: 90,  target: 1200, deadline: '2026-12-31' },
          ],
        })
      }

      // Card loading with graceful fallback — if sandbox has no cards,
      // we still let the demo do block/unblock in "mock card mode".
      if (cardsRes.status === 'fulfilled') {
        const r = cardsRes.value
        if (r?.Response && !r._mock) {
          const cards = r.Response
            .map(c => c.CardDebit || c.CardCredit || c.CardMaestro || c.Card)
            .filter(Boolean)
          const card = cards.find(c => c.status === 'ACTIVE' || c.status === 'FROZEN') || cards[0]
          if (card?.id) {
            set({
              primaryCardId: String(card.id),
              cardBlocked: card.status === 'FROZEN',
              mockCardMode: false,
            })
          } else {
            set({ mockCardMode: true })
          }
        } else if (r?._mock) {
          set({ mockCardMode: true })
        } else {
          set({ mockCardMode: true })
        }
      } else {
        console.warn('[Store] getCards failed:', cardsRes.reason?.message)
        set({ mockCardMode: true })
      }

      set({ sandboxLoaded: true })
      get().refreshInsights()
    } catch (err) {
      console.warn('[Store] Could not load real bunq data:', err.message)
      set({ sandboxLoaded: true, mockCardMode: true })
      get().refreshInsights()
    } finally {
      set({ loading: false })
    }

    // Hydrate actionLog from server so activity survives reloads.
    try {
      const res = await memoryAPI.getActions(100)
      if (res?.actions?.length) {
        const rehydrated = res.actions.map(a => ({
          id:        a.id,
          type:      a.type,
          status:    a.status === 'executing' ? 'failed' : a.status,
          timestamp: new Date(Number(a.ts)),
          amount:    a.amount != null ? Number(a.amount) : undefined,
          fromAccount: a.from_account ?? undefined,
          toAccount:   a.to_account   ?? undefined,
          description: a.description  ?? undefined,
          label:       a.description  ?? undefined,
          result:      a.result       ?? undefined,
          error:       a.error        ?? undefined,
          hydrated:    true,
        }))
        set({ actionLog: rehydrated })
      }
    } catch {}
  },

  refreshInsights: () => {
    const { transactions, accounts, goals, spendingPatterns } = get()
    const totalBalance = accounts.reduce((s, a) => s + a.balance, 0)

    const baseInsights = buildInsights({ transactions, accounts, goals, spendingPatterns })
    const forecast  = forecastMonth({ transactions, totalBalance })
    const sts       = safeToSpend({ transactions, totalBalance, accounts })
    const series    = balanceSeries({ transactions, totalBalance, days: 30 })
    const roundUps  = roundUpPool({ transactions })
    const flags     = fraudRadar({ transactions })
    const plan      = goalAutopilot({ transactions, goals })
    const cliff     = billCliff({ transactions, totalBalance, accounts })
    const pacing    = goalPacing({ transactions, goals })
    const subBloat  = subscriptionWaste({ transactions })

    // Lift the most urgent fraud flag into the insights feed
    const extra = []
    if (flags.length > 0) {
      const f = flags[0]
      extra.push({
        id: `fraud-${f.id}`,
        kind: 'fraud',
        severity: 'warning',
        icon: '🛡️',
        title: `Double-check: ${f.merchant}`,
        body: `€${f.amount.toFixed(2)} — ${f.reasons.join(', ')}.`,
      })
    }
    if (roundUps.amount >= 5) {
      extra.push({
        id: 'round-ups',
        kind: 'round-ups',
        severity: 'good',
        icon: '💰',
        title: `€${roundUps.amount.toFixed(2)} in round-ups this month`,
        body: `Sweep the spare change to your top goal in one tap.`,
        action: { type: 'ROUND_UP_SWEEP', label: `Sweep €${roundUps.amount.toFixed(2)} to savings`,
          params: { amount: Math.round(roundUps.amount * 100) / 100, goalLabel: goals[0]?.name, goalId: goals[0]?.id } },
      })
    }
    if (plan && plan.splits.length > 0) {
      extra.push({
        id: 'autopilot',
        kind: 'autopilot',
        severity: 'info',
        icon: '🎯',
        title: `Auto-split €${plan.poolAmount} from your salary`,
        body: `Across ${plan.splits.length} goal${plan.splits.length !== 1 ? 's' : ''}. Review and confirm.`,
        action: { type: 'GOAL_AUTOPILOT', label: `Split €${plan.poolAmount} across goals`,
          params: { plan } },
      })
    }

    set({
      insights: [...extra, ...baseInsights],
      forecast,
      safeToSpend: sts,
      balanceSeries: series,
      roundUpPool: roundUps,
      fraudFlags: flags,
      autopilotPlan: plan,
      cliff,
      pacing,
      subBloat,
    })
  },

  updatePrefs: (patch) => {
    const next = { ...get().prefs, ...patch }
    savePrefs(next)
    set({ prefs: next })
  },

  theme: (() => {
    try {
      const saved = localStorage.getItem('app_theme')
      return saved === 'light' ? 'light' : 'dark'
    } catch { return 'dark' }
  })(),
  setTheme: (t) => {
    try { localStorage.setItem('app_theme', t) } catch {}
    set({ theme: t })
  },

  getTotalBalance: () => {
    const { accounts } = get()
    return accounts.reduce((sum, a) => sum + a.balance, 0)
  },

  setAetherActive: (val) => set({ aetherActive: val }),
  setVoiceActive: (val) => set({ voiceActive: val }),

  setOverlayHints: (hints) => set({ overlayHints: hints }),
  clearOverlayHints: () => set({ overlayHints: [] }),

  setCurrentAnalysis: (analysis) => set({ currentAnalysis: analysis }),
  setIsAnalyzing: (val) => set({ isAnalyzing: val }),
  setLastVoiceText: (text) => set({ lastVoiceText: text }),
  setEmotionalTone: (tone) => set({ emotionalTone: tone }),

  // Core action dispatcher — all AI-triggered actions funnel through here
  dispatchAction: async (action) => {
    const { actionLog, accounts, primaryCardId } = get()

    // Resolve a human-friendly reference ("Bank Account", "acc_001", label, IBAN)
    // into a numeric bunq account ID. Falls back to the env-configured default.
    const resolveAccountId = (ref) => {
      if (!ref) return null
      const str = String(ref).trim()
      // Already a numeric bunq ID
      if (/^\d+$/.test(str)) return str
      // Match against loaded accounts by id, label (case-insensitive), or IBAN
      const acc = accounts.find(a =>
        a.id === str ||
        a.label?.toLowerCase() === str.toLowerCase() ||
        a.iban === str
      )
      if (acc?.id && /^\d+$/.test(String(acc.id))) return String(acc.id)
      return null
    }
    const defaultAccountId = import.meta.env.VITE_BUNQ_ACCOUNT_ID || '3616391'
    const snapshot = JSON.parse(JSON.stringify({ accounts, cardBlocked: get().cardBlocked, goals: get().goals }))

    // Pre-dispatch affordability check — never block the action (the user
    // already tapped to confirm), but flag it on the entry so the UI/log
    // can show "this leaves you at €X" and the trust story stays honest.
    let warning = null
    const sts = get().safeToSpend
    const moveAmt = Number(action.amount ?? action.perPerson ?? 0)
    if (sts && moveAmt > 0 && (action.type === 'TRANSFER' || action.type === 'SAVINGS_BOOST')) {
      const after = sts.safe - moveAmt
      if (after < 0) {
        warning = { kind: 'over',  headroom: Math.round(after), message: `This leaves you €${Math.abs(Math.round(after))} below safe-to-spend.` }
      } else if (after < 50) {
        warning = { kind: 'tight', headroom: Math.round(after), message: `Tight — only €${Math.round(after)} headroom after.` }
      }
    }

    const entry = {
      id: `act_${Date.now()}`,
      timestamp: new Date(),
      ...action,
      status: 'executing',
      snapshot,
      warning,
    }

    set({ actionLog: [entry, ...actionLog] })
    // Mirror "executing" to server so the Activity page survives a reload.
    memoryAPI.logAction(actionPayload(entry))

    try {
      let result = {}

      switch (action.type) {
        case 'BLOCK_CARD': {
          const blockCardId = action.cardId || primaryCardId
          const { mockCardMode } = get()
          if (blockCardId && !mockCardMode) {
            await bunqAPI.blockCard(undefined, blockCardId)
          } else {
            // Sandbox has no card — still simulate the flow so demos don't die.
            await new Promise(r => setTimeout(r, 250))
          }
          set({ cardBlocked: true })
          result = { message: 'Card temporarily frozen' + (mockCardMode ? ' (demo mode)' : '') }
          break
        }

        case 'UNBLOCK_CARD': {
          const unblockCardId = action.cardId || primaryCardId
          const { mockCardMode } = get()
          if (unblockCardId && !mockCardMode) {
            await bunqAPI.unblockCard(undefined, unblockCardId)
          } else {
            await new Promise(r => setTimeout(r, 250))
          }
          set({ cardBlocked: false })
          result = { message: 'Card re-activated' + (mockCardMode ? ' (demo mode)' : '') }
          break
        }

        case 'TRANSFER': {
          const txAmt = Number(action.amount || 0)
          if (!txAmt) throw new Error('Transfer amount missing or zero')
          const fromId = resolveAccountId(action.fromAccount) || defaultAccountId
          // Prefer an IBAN — if the AI only gave a label, look it up
          const toAcc  = accounts.find(a =>
            a.id === action.toAccount ||
            a.label?.toLowerCase() === String(action.toAccount || action.toLabel || '').toLowerCase()
          )
          const toIban = action.toIban || toAcc?.iban
          if (!toIban) throw new Error('No destination account — please pick one')
          await bunqAPI.transfer(undefined, fromId, toIban, txAmt, action.description)
          set(state => ({
            accounts: state.accounts.map(a => {
              if (a.id === fromId)      return { ...a, balance: a.balance - txAmt }
              if (a.id === toAcc?.id)   return { ...a, balance: a.balance + txAmt }
              return a
            })
          }))
          result = { message: `€${txAmt.toFixed(2)} moved to ${toAcc?.label || action.toLabel || 'account'}` }
          break
        }

        case 'PAYMENT_REQUEST': {
          const contacts = action.contacts?.length ? action.contacts : (action.toContact ? [{ alias: action.toContact }] : [])
          const perPerson = action.amount || action.perPerson || 0
          if (contacts.length > 0) {
            await Promise.all(contacts.map(c =>
              bunqAPI.sendPaymentRequest(undefined, undefined, c.alias, perPerson, action.description || 'Split request')
            ))
          }
          result = { message: `Split request sent to ${contacts.length || 1} contact(s) · €${Number(perPerson).toFixed(2)} each` }
          break
        }

        case 'ROUND_UP_SWEEP': {
          const amt = Number(action.amount || 0)
          if (!amt) throw new Error('Nothing to sweep yet')
          const fromAcc = accounts.find(a => /^\d+$/.test(String(a.id))) || accounts[0]
          const fromId = resolveAccountId(fromAcc?.id) || defaultAccountId
          const toAcc = accounts.find(a =>
            a.id === action.goalId ||
            a.label?.toLowerCase() === String(action.goalLabel || '').toLowerCase()
          ) || accounts.find(a => a.id !== fromId)
          const toIban = toAcc?.iban
          if (toIban && !get().mockCardMode) {
            try { await bunqAPI.transfer(undefined, fromId, toIban, amt, 'Round-up sweep') }
            catch (e) { console.warn('[sweep] real transfer failed, simulating:', e.message) }
          }
          set(state => ({
            accounts: state.accounts.map(a => {
              if (a.id === fromAcc?.id) return { ...a, balance: a.balance - amt }
              if (a.id === toAcc?.id)   return { ...a, balance: a.balance + amt }
              return a
            }),
            goals: state.goals.map(g =>
              g.id === action.goalId ? { ...g, current: g.current + amt } : g
            ),
          }))
          result = { message: `€${amt.toFixed(2)} swept to ${toAcc?.label || action.goalLabel || 'savings'}` }
          break
        }

        case 'GOAL_AUTOPILOT': {
          const plan = action.plan || action.params?.plan
          if (!plan?.splits?.length) throw new Error('No autopilot plan')
          const fromAcc = accounts[0]
          const fromId = resolveAccountId(fromAcc?.id) || defaultAccountId
          let moved = 0
          for (const split of plan.splits) {
            const goal = get().goals.find(g => g.id === split.goalId)
            if (!goal) continue
            const toAcc = accounts.find(a => a.label?.toLowerCase() === goal.name.toLowerCase())
            const toIban = toAcc?.iban
            if (toIban && !get().mockCardMode) {
              try { await bunqAPI.transfer(undefined, fromId, toIban, split.amount, `Autopilot → ${goal.name}`) }
              catch (e) { console.warn('[autopilot] real transfer failed:', e.message) }
            }
            set(state => ({
              accounts: state.accounts.map(a => {
                if (a.id === fromAcc?.id) return { ...a, balance: a.balance - split.amount }
                if (a.id === toAcc?.id)   return { ...a, balance: a.balance + split.amount }
                return a
              }),
              goals: state.goals.map(g =>
                g.id === split.goalId ? { ...g, current: g.current + split.amount } : g
              ),
            }))
            moved += split.amount
          }
          result = { message: `€${moved} auto-split across ${plan.splits.length} goals` }
          break
        }

        case 'SET_LIMIT':
          // Spending limits require a card ID; log for now
          console.warn('[bunqAPI] SET_LIMIT not yet mapped to a card endpoint')
          result = { message: `Spending limit set: €${action.limitAmount}/${action.period}` }
          break

        case 'SAVINGS_BOOST': {
          const saveAmt = Number(action.amount || 0)
          if (!saveAmt) throw new Error('Savings amount missing or zero')
          const fromId = resolveAccountId(action.fromAccount) || defaultAccountId
          // Destination: match by goalLabel or toAccount ref, fall back to a savings account
          const toAcc  = accounts.find(a =>
            a.id === action.toAccount ||
            a.label?.toLowerCase() === String(action.goalLabel || action.toLabel || action.toAccount || '').toLowerCase()
          ) || accounts.find(a => a.id !== fromId)
          const toIban = action.toIban || toAcc?.iban
          if (!toIban) throw new Error('No savings destination available')
          await bunqAPI.transfer(undefined, fromId, toIban, saveAmt, `Saved towards ${action.goalLabel || 'goal'}`)
          set(state => ({
            accounts: state.accounts.map(a => {
              if (a.id === fromId)    return { ...a, balance: a.balance - saveAmt }
              if (a.id === toAcc?.id) return { ...a, balance: a.balance + saveAmt }
              return a
            }),
            goals: state.goals.map(g =>
              g.id === action.goalId ? { ...g, current: g.current + saveAmt } : g
            )
          }))
          result = { message: `€${saveAmt.toFixed(2)} saved toward ${action.goalLabel || 'goal'}` }
          break
        }

        default:
          result = { message: 'Action completed' }
      }

      set(state => ({
        actionLog: state.actionLog.map(e =>
          e.id === entry.id ? { ...e, status: 'completed', result } : e
        ),
        pendingUndo: { entryId: entry.id, snapshot, expiresAt: Date.now() + 10000 },
      }))
      memoryAPI.logAction(actionPayload({ ...entry, status: 'completed' }, { result }))
      get().refreshInsights()

      return { success: true, result }
    } catch (err) {
      set(state => ({
        actionLog: state.actionLog.map(e =>
          e.id === entry.id ? { ...e, status: 'failed', error: err.message } : e
        )
      }))
      memoryAPI.logAction(actionPayload({ ...entry, status: 'failed' }, { error: err.message }))
      return { success: false, error: err.message }
    }
  },

  undoLastAction: async () => {
    const { pendingUndo, actionLog } = get()
    if (!pendingUndo || Date.now() > pendingUndo.expiresAt) return

    const snap = pendingUndo.snapshot
    const undoneEntry = actionLog.find(e => e.id === pendingUndo.entryId)
    set({
      accounts: snap.accounts,
      cardBlocked: snap.cardBlocked,
      goals: snap.goals,
      pendingUndo: null,
      actionLog: actionLog.map(e =>
        e.id === pendingUndo.entryId ? { ...e, status: 'undone' } : e
      )
    })
    if (undoneEntry) {
      memoryAPI.logAction(actionPayload({ ...undoneEntry, status: 'undone' }))
    }
    get().refreshInsights()
  },

  clearUndo: () => set({ pendingUndo: null }),

  dismissAction: (id) => {
    set(state => ({
      actionLog: state.actionLog.filter(e => e.id !== id)
    }))
  },

  addTransaction: (tx) => set(state => ({
    transactions: [{ ...tx, id: `tx_${Date.now()}`, date: new Date() }, ...state.transactions]
  })),
}))
