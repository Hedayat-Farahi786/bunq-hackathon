/**
 * Aether Forecast & Safety Math
 *
 * Deterministic projections derived from transaction history:
 *  - monthly forecast (projected end-of-month balance)
 *  - safe-to-spend (balance minus known recurring charges + goal auto-saves)
 *  - 30-day balance timeline
 *  - round-up pool for the current month
 *  - fraud-radar flags on recent activity
 *  - goal autopilot plan for the next salary deposit
 *
 * Every output is derived from whatever transactions the caller passes in.
 * No side-effects, no network calls.
 */

import { detectRecurring } from './insights'

const DAY = 24 * 60 * 60 * 1000

function startOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}
function endOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59)
}
function daysInMonth(d = new Date()) {
  return endOfMonth(d).getDate()
}

/** Forecast end-of-month balance from month-to-date trajectory. */
export function forecastMonth({ transactions = [], totalBalance = 0 } = {}) {
  const now = new Date()
  const mStart = startOfMonth(now)
  const elapsedDays = Math.max(1, Math.ceil((now - mStart) / DAY))
  const remainingDays = daysInMonth(now) - elapsedDays

  const monthTxs = transactions.filter(t => new Date(t.date) >= mStart)
  const spent = monthTxs.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0)
  const earned = monthTxs.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0)

  const dailyBurn = spent / elapsedDays
  const projectedRemainingSpend = dailyBurn * remainingDays

  // Assume no additional income for remaining days unless we detect salary recurrence later.
  const projectedEndBalance = totalBalance - projectedRemainingSpend

  return {
    elapsedDays,
    remainingDays,
    spent: Math.round(spent),
    earned: Math.round(earned),
    dailyBurn: Math.round(dailyBurn),
    projectedRemainingSpend: Math.round(projectedRemainingSpend),
    projectedEndBalance: Math.round(projectedEndBalance),
  }
}

/**
 * Safe-to-spend = current balance
 *   minus known recurring charges still due this month
 *   minus a minimum safety buffer (€50 per account, capped at €200)
 * Result is floored at 0.
 */
export function safeToSpend({ transactions = [], totalBalance = 0, accounts = [] } = {}) {
  const now = new Date()
  const mEnd = endOfMonth(now)

  const subs = detectRecurring(transactions)
  let upcomingRecurring = 0
  const upcoming = []
  subs.forEach(s => {
    const last = new Date(s.lastDate)
    const nextCharge = new Date(last.getTime() + 30 * DAY)
    if (nextCharge <= mEnd && nextCharge > now) {
      upcomingRecurring += s.amount
      upcoming.push({ merchant: s.merchant, amount: s.amount, date: nextCharge })
    }
  })

  const buffer = Math.min(200, 50 * Math.max(1, accounts.length))
  const raw = totalBalance - upcomingRecurring - buffer
  return {
    safe: Math.max(0, Math.round(raw)),
    buffer,
    upcomingRecurring: Math.round(upcomingRecurring),
    upcoming: upcoming.sort((a, b) => a.date - b.date),
  }
}

/** 30-day balance timeline — walks backwards from current total. */
export function balanceSeries({ transactions = [], totalBalance = 0, days = 30 } = {}) {
  const since = Date.now() - days * DAY
  const recent = transactions
    .filter(t => new Date(t.date).getTime() >= since)
    .sort((a, b) => new Date(a.date) - new Date(b.date))

  // Walk forward from (totalBalance - net of recent tx) at `days` ago,
  // producing one point per day.
  const netRecent = recent.reduce((s, t) => s + Number(t.amount || 0), 0)
  let running = totalBalance - netRecent

  const points = []
  for (let i = days; i >= 0; i--) {
    const dayStart = new Date(Date.now() - i * DAY)
    dayStart.setHours(0, 0, 0, 0)
    const dayEnd = dayStart.getTime() + DAY
    // Apply any tx that landed in this day
    const dayNet = recent
      .filter(t => {
        const ts = new Date(t.date).getTime()
        return ts >= dayStart.getTime() && ts < dayEnd
      })
      .reduce((s, t) => s + Number(t.amount || 0), 0)
    running += dayNet
    points.push({ date: dayStart.getTime(), balance: Math.round(running * 100) / 100 })
  }
  return points
}

/** Total round-up pool for current month — each expense rounded up to nearest €1. */
export function roundUpPool({ transactions = [] } = {}) {
  const mStart = startOfMonth()
  let pool = 0
  let count = 0
  for (const tx of transactions) {
    if (tx.amount >= 0) continue
    if (new Date(tx.date) < mStart) continue
    const abs = Math.abs(tx.amount)
    const rounded = Math.ceil(abs)
    const diff = rounded - abs
    if (diff > 0.01) {
      pool += diff
      count += 1
    }
  }
  return { amount: Math.round(pool * 100) / 100, count }
}

/**
 * Fraud radar — scans recent transactions for suspicious signals:
 *  - first-time counterparty IBAN (never seen before in history)
 *  - amount ≥ 3× median of recent expenses
 *  - late-night timestamp (00:00-05:00) on a debit
 *
 * Returns a flat list of flagged tx with the reason.
 */
export function fraudRadar({ transactions = [] } = {}) {
  if (transactions.length < 5) return []

  const expenses = transactions.filter(t => t.amount < 0)
  const amounts = expenses.map(t => Math.abs(t.amount)).sort((a, b) => a - b)
  const median = amounts[Math.floor(amounts.length / 2)] || 0

  // Build IBAN → first-seen map from the FULL history
  const firstSeen = new Map()
  for (const tx of [...transactions].sort((a, b) => new Date(a.date) - new Date(b.date))) {
    const iban = tx.counterpartyIban
    if (!iban) continue
    if (!firstSeen.has(iban)) firstSeen.set(iban, new Date(tx.date).getTime())
  }

  const windowStart = Date.now() - 14 * DAY
  const flagged = []
  for (const tx of expenses) {
    const ts = new Date(tx.date).getTime()
    if (ts < windowStart) continue

    const reasons = []
    const abs = Math.abs(tx.amount)

    if (median > 0 && abs >= median * 3 && abs >= 75) {
      reasons.push(`about ${Math.round(abs / median)}× your usual spend`)
    }

    const iban = tx.counterpartyIban
    if (iban && firstSeen.get(iban) === ts && abs >= 50) {
      reasons.push('first time sending to this account')
    }

    const hour = new Date(tx.date).getHours()
    if ((hour >= 0 && hour < 5) && abs >= 40) {
      reasons.push('late-night charge')
    }

    if (reasons.length > 0) {
      flagged.push({
        id: tx.id,
        merchant: tx.merchant,
        amount: abs,
        date: tx.date,
        reasons,
      })
    }
  }
  return flagged.sort((a, b) => new Date(b.date) - new Date(a.date))
}

/**
 * Goal autopilot — given the most recent salary deposit, propose a split
 * across the goals the user is not yet close to reaching.
 * Default split: 20% of salary, distributed across active goals weighted
 * by remaining-to-target (goals further from done get a bigger share).
 */
export function goalAutopilot({ transactions = [], goals = [], percentOfSalary = 0.2 } = {}) {
  const salary = transactions
    .filter(t => t.amount > 0 && /salary|salaris|loon|payroll/i.test(t.merchant || t.description || ''))
    .sort((a, b) => new Date(b.date) - new Date(a.date))[0]

  if (!salary) return null

  const pool = Math.round(salary.amount * percentOfSalary)
  if (pool < 10) return null

  const active = goals.filter(g => g.current < g.target)
  if (active.length === 0) return null

  const totalRemaining = active.reduce((s, g) => s + (g.target - g.current), 0) || 1
  const splits = active.map(g => {
    const remaining = g.target - g.current
    const share = Math.round((remaining / totalRemaining) * pool)
    return { goalId: g.id, goalName: g.name, amount: share }
  }).filter(s => s.amount >= 5)

  return {
    salaryAmount: salary.amount,
    salaryDate: salary.date,
    poolAmount: pool,
    splits,
  }
}
