/**
 * Aether Insights Engine
 *
 * Derives "Aether noticed…" observations from raw transactions + accounts.
 * All logic is deterministic — no AI calls — so it runs instantly on every
 * state change and is 100% consistent for the demo.
 *
 * Each insight has:
 *   { id, kind, severity, icon, title, body, action? }
 *   severity: 'info' | 'good' | 'careful' | 'warning'
 *   kind:     stable id for grouping/dedupe
 *   action:   optional { type, label, params } — fed straight to dispatchAction
 */

const DAY = 24 * 60 * 60 * 1000

function eur(n) {
  return `€${Number(n).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Normalise merchant name for grouping — "NETFLIX.COM" and "Netflix NL" collapse */
function normaliseMerchant(name = '') {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+(com|nl|eu|be|de|uk|inc|bv)\b/g, '')
    .trim()
    .split(' ').slice(0, 2).join(' ')
}

/** Detect likely recurring subscriptions: same normalised merchant, >=2 charges, similar amount, ~30-day gaps */
export function detectRecurring(transactions = []) {
  const expenses = transactions.filter(t => t.amount < 0)
  const byMerchant = new Map()

  for (const tx of expenses) {
    const key = normaliseMerchant(tx.merchant || tx.description || '')
    if (!key || key.length < 3) continue
    if (!byMerchant.has(key)) byMerchant.set(key, [])
    byMerchant.get(key).push(tx)
  }

  const subs = []
  for (const [key, group] of byMerchant) {
    if (group.length < 2) continue
    const amounts = group.map(t => Math.abs(t.amount))
    const avg = amounts.reduce((s, v) => s + v, 0) / amounts.length
    // Similar amounts = subscription-y (within 15% of each other)
    const similar = amounts.every(a => Math.abs(a - avg) / avg < 0.15)
    if (!similar) continue
    // Display name from newest charge
    const sorted = [...group].sort((a, b) => new Date(b.date) - new Date(a.date))
    subs.push({
      key,
      merchant: sorted[0].merchant || sorted[0].description || key,
      amount:   avg,
      count:    group.length,
      lastDate: sorted[0].date,
    })
  }
  return subs.sort((a, b) => b.amount * b.count - a.amount * a.count)
}

/** Pull real "contacts" from counterparty aliases in recent transactions. */
export function extractContacts(transactions = [], max = 6) {
  const map = new Map()
  for (const tx of transactions) {
    const name = tx.counterpartyName || tx.merchant
    const alias = tx.counterpartyAlias || tx.counterpartyIban
    if (!name || !alias) continue
    // Skip obvious merchants / corporate names
    if (/bv|b\.v\.|holding|gmbh|ltd|ltd\.|llc|shop|store|supermarkt|restaurant/i.test(name)) continue
    const key = alias
    if (!map.has(key)) {
      map.set(key, { id: key, name, alias, count: 1 })
    } else {
      map.get(key).count += 1
    }
  }
  return Array.from(map.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, max)
}

/** Spending per category in the last N days */
export function spendByCategory(transactions = [], days = 30) {
  const since = Date.now() - days * DAY
  const out = {}
  for (const tx of transactions) {
    if (tx.amount >= 0) continue
    if (new Date(tx.date).getTime() < since) continue
    const cat = tx.category || 'Other'
    out[cat] = (out[cat] || 0) + Math.abs(tx.amount)
  }
  return out
}

/** Generate the dashboard "Aether noticed" feed */
export function buildInsights({ transactions = [], accounts = [], goals = [], spendingPatterns } = {}) {
  const out = []

  // 1. Recurring / subscription detection
  const subs = detectRecurring(transactions)
  if (subs.length >= 1) {
    const top = subs[0]
    const monthly = top.amount
    out.push({
      id: `sub-${top.key}`,
      kind: 'subscription',
      severity: 'info',
      icon: '🔁',
      title: `${top.merchant} is a regular charge`,
      body: `You've been billed ${top.count}× at around ${eur(monthly)}. Tap if it's time to review.`,
    })
  }
  if (subs.length >= 3) {
    const totalMonthly = subs.reduce((s, v) => s + v.amount, 0)
    out.push({
      id: 'subs-total',
      kind: 'subs-total',
      severity: 'careful',
      icon: '📺',
      title: `${subs.length} recurring charges add up`,
      body: `Together they cost about ${eur(totalMonthly)} each time. A quick review could free up cash.`,
    })
  }

  // 2. Weekly spending spike
  const weekAgo = Date.now() - 7 * DAY
  const twoWeeksAgo = Date.now() - 14 * DAY
  const thisWeek = transactions
    .filter(t => t.amount < 0 && new Date(t.date).getTime() >= weekAgo)
    .reduce((s, t) => s + Math.abs(t.amount), 0)
  const prevWeek = transactions
    .filter(t => t.amount < 0 && new Date(t.date).getTime() >= twoWeeksAgo && new Date(t.date).getTime() < weekAgo)
    .reduce((s, t) => s + Math.abs(t.amount), 0)

  if (prevWeek > 50 && thisWeek > prevWeek * 1.4) {
    const delta = Math.round(((thisWeek - prevWeek) / prevWeek) * 100)
    out.push({
      id: 'spend-spike',
      kind: 'spike',
      severity: 'warning',
      icon: '📈',
      title: `You're spending ${delta}% more this week`,
      body: `${eur(thisWeek)} so far vs ${eur(prevWeek)} last week. Want to cool it for a few days?`,
    })
  } else if (prevWeek > 50 && thisWeek < prevWeek * 0.7) {
    const saved = prevWeek - thisWeek
    out.push({
      id: 'spend-down',
      kind: 'down',
      severity: 'good',
      icon: '✨',
      title: `You're spending less this week`,
      body: `About ${eur(saved)} less than last week. Nice self-control — worth saving the difference?`,
      action: { type: 'SAVINGS_BOOST', label: `Save ${eur(Math.round(saved))} towards your goal`,
        params: { amount: Math.round(saved), goalLabel: goals[0]?.name } },
    })
  }

  // 3. Goal lag / goal close
  goals.forEach(g => {
    const pct = g.current / g.target
    if (pct >= 0.9 && pct < 1) {
      const remaining = g.target - g.current
      out.push({
        id: `goal-near-${g.id}`,
        kind: 'goal-near',
        severity: 'good',
        icon: g.icon || '🎯',
        title: `So close to "${g.name}"`,
        body: `Just ${eur(remaining)} to go. One last push?`,
        action: { type: 'SAVINGS_BOOST', label: `Finish ${g.name} — ${eur(remaining)}`,
          params: { amount: remaining, goalId: g.id, goalLabel: g.name } },
      })
    }
    if (g.deadline && pct < 0.6) {
      const deadline = new Date(g.deadline)
      const daysLeft = Math.round((deadline.getTime() - Date.now()) / DAY)
      if (daysLeft > 0 && daysLeft < 90) {
        out.push({
          id: `goal-lag-${g.id}`,
          kind: 'goal-lag',
          severity: 'careful',
          icon: g.icon || '⏳',
          title: `"${g.name}" is behind schedule`,
          body: `${daysLeft} days left, ${eur(g.target - g.current)} still to save.`,
        })
      }
    }
  })

  // 4. Big single transaction — e.g. ≥ €200 and ≥ 2× the median expense
  const expenses = transactions.filter(t => t.amount < 0).map(t => Math.abs(t.amount))
  if (expenses.length >= 5) {
    const sorted = [...expenses].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    const recent = transactions
      .filter(t => t.amount < 0 && new Date(t.date).getTime() >= weekAgo)
      .sort((a, b) => a.amount - b.amount)[0]
    if (recent && Math.abs(recent.amount) >= 200 && Math.abs(recent.amount) >= median * 2) {
      out.push({
        id: `big-${recent.id}`,
        kind: 'big-tx',
        severity: 'info',
        icon: '💳',
        title: `Big payment at ${recent.merchant}`,
        body: `${eur(Math.abs(recent.amount))} — bigger than your usual. Want to split it?`,
        action: { type: 'PAYMENT_REQUEST', label: `Split ${eur(Math.abs(recent.amount))}`,
          params: { amount: Math.abs(recent.amount), description: `Split: ${recent.merchant}` } },
      })
    }
  }

  // 5. Low main account balance
  const main = accounts[0]
  if (main && main.balance < 100) {
    out.push({
      id: 'low-main',
      kind: 'low-balance',
      severity: 'warning',
      icon: '⚠️',
      title: `${main.label} is running low`,
      body: `Only ${eur(main.balance)} left. Want to top it up from another account?`,
    })
  }

  return out
}

/** Threshold helpers */
export const RISK_ORDER = { low: 0, medium: 1, high: 2, critical: 3 }
export function passesThreshold(level = 'low', threshold = 'medium') {
  return (RISK_ORDER[String(level).toLowerCase()] ?? 0) >= (RISK_ORDER[String(threshold).toLowerCase()] ?? 1)
}
