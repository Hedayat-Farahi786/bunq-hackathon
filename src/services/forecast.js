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
  // 30-day horizon (not month-end) so a rent payment due 5 days into next
  // month still counts toward "what's already spoken for". Matches the
  // server-side affordability engine.
  const horizon = new Date(now.getTime() + 30 * DAY)

  const subs = detectRecurring(transactions)
  let upcomingRecurring = 0
  const upcoming = []
  subs.forEach(s => {
    const last = new Date(s.lastDate)
    const nextCharge = new Date(last.getTime() + 30 * DAY)
    if (nextCharge <= horizon && nextCharge > now) {
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
    upcoming: upcoming.sort((a, b) => new Date(a.date) - new Date(b.date)),
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
 * Bill cliff — earliest *material* upcoming bill. Material means:
 *   • amount ≥ 20% of current balance AND ≥ €100 (e.g. rent), OR
 *   • the bill pushes the running balance below the safety buffer.
 * Otherwise the first upcoming bill is returned with status "covered" so
 * the dashboard tile still has something useful to render.
 */
export function billCliff({ transactions = [], totalBalance = 0, accounts = [] } = {}) {
  const sts = safeToSpend({ transactions, totalBalance, accounts })
  const buffer = sts.buffer
  let running = totalBalance
  let fallback = null
  for (const ob of sts.upcoming) {
    const before = running
    running = before - Number(ob.amount || 0)
    const dueIn = Math.max(0, Math.ceil((new Date(ob.date).getTime() - Date.now()) / DAY))
    const isBig = Number(ob.amount) >= 100 && Number(ob.amount) >= totalBalance * 0.20
    const isBreach = running < buffer
    if (isBig || isBreach) {
      const status = running < 0 ? 'shortfall' : isBreach ? 'tight' : 'covered'
      return {
        merchant: ob.merchant,
        amount:   Math.round(Number(ob.amount) * 100) / 100,
        dueDate:  ob.date,
        dueIn,
        balanceAfter: Math.round(running * 100) / 100,
        breachAmount: Math.max(0, Math.round((buffer - running) * 100) / 100),
        status,
      }
    }
    if (!fallback) {
      fallback = {
        merchant: ob.merchant,
        amount:   Math.round(Number(ob.amount) * 100) / 100,
        dueDate:  ob.date,
        dueIn,
        balanceAfter: Math.round(running * 100) / 100,
        breachAmount: 0,
        status:   'covered',
      }
    }
  }
  return fallback
}

/**
 * Goal pacing — at user's current monthly surplus split evenly across active
 * goals, when does each goal hit, and how does that compare to its deadline?
 */
export function goalPacing({ transactions = [], goals = [] } = {}) {
  if (!goals.length) return []
  const now = new Date()
  const mStart = startOfMonth(now)
  const monthIn = transactions.filter(t => t.amount > 0 && new Date(t.date) >= mStart)
                              .reduce((s, t) => s + t.amount, 0)
  const monthOut = transactions.filter(t => t.amount < 0 && new Date(t.date) >= mStart)
                               .reduce((s, t) => s + Math.abs(t.amount), 0)
  const surplus = Math.max(0, monthIn - monthOut)
  const active = goals.filter(g => Number(g.current || 0) < Number(g.target || 0))
  const perGoal = active.length ? surplus / active.length : 0

  return goals.map(g => {
    const remaining = Math.max(0, Number(g.target) - Number(g.current))
    const pct = Number(g.target) > 0 ? Math.round((Number(g.current) / Number(g.target)) * 100) : 0
    if (remaining === 0) return { id: g.id, name: g.name, pct, etaMonths: 0, etaDate: null, lateMonths: 0, deadline: g.deadline || null, status: 'reached' }
    const etaMonths = perGoal > 0 ? remaining / perGoal : Infinity
    const etaDate = Number.isFinite(etaMonths) ? new Date(now.getTime() + etaMonths * 30 * DAY) : null
    let lateMonths = 0, status = 'on-track'
    if (g.deadline && etaDate) {
      const dl = new Date(g.deadline)
      const monthsLate = (etaDate.getTime() - dl.getTime()) / (30 * DAY)
      if (monthsLate > 1) { lateMonths = Math.round(monthsLate); status = 'late' }
      else if (monthsLate > -1) status = 'tight'
    } else if (!Number.isFinite(etaMonths)) {
      status = 'stalled'
    }
    return {
      id: g.id, name: g.name, pct,
      remaining: Math.round(remaining),
      etaMonths: Number.isFinite(etaMonths) ? Math.round(etaMonths * 10) / 10 : null,
      etaDate:   etaDate ? etaDate.toISOString().slice(0, 10) : null,
      deadline:  g.deadline || null,
      lateMonths,
      status,
    }
  })
}

// Recurring charges you can't cancel — excluded from "subscription bloat"
// totals so the user doesn't see €854/mo of "subscriptions" when €820 of
// that is rent.
const FIXED_OBLIGATIONS_RX = /\b(rent|huur|mortgage|hypothee|electric|stroom|gas|water|insurance|verzeker|t\s?mobile|vodafone|kpn|ziggo|odido|essent|eneco|vattenfall)\b/i

/**
 * Subscription waste — discretionary recurring only.
 */
export function subscriptionWaste({ transactions = [] } = {}) {
  const subs = detectRecurring(transactions)
  if (!subs.length) return null
  const discretionary = subs.filter(s => !FIXED_OBLIGATIONS_RX.test(s.merchant || ''))
  if (!discretionary.length) return null
  const totalMonthly = Math.round(discretionary.reduce((s, x) => s + Number(x.amount || 0), 0) * 100) / 100
  const skippable = /netflix|spotify|disney|youtube|hbo|prime|paramount|apple\s?tv|twitch|patreon|notion|adobe|figma|canva|gym|fitness/i
  const candidate = discretionary.filter(s => skippable.test(s.merchant) && Number(s.amount) >= 8)
                                 .sort((a, b) => Number(b.amount) - Number(a.amount))[0] || null
  const biggest = discretionary.sort((a, b) => Number(b.amount) - Number(a.amount))[0]
  return {
    count: discretionary.length,
    totalMonthly,
    biggest:   biggest   ? { merchant: biggest.merchant,   amount: Math.round(Number(biggest.amount) * 100) / 100 }   : null,
    candidate: candidate ? { merchant: candidate.merchant, amount: Math.round(Number(candidate.amount) * 100) / 100 } : null,
  }
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
