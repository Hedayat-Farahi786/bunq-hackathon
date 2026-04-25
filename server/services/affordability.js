/**
 * Aether Judgment Engine — server-side, deterministic.
 *
 * Computes a structured affordability verdict from the financial context the
 * client already sends with every /api/ai/analyse request, plus a best-effort
 * "requested amount" extracted from the user's voice text or the locked
 * identified product.
 *
 * The output gets injected into Claude's prompt as authoritative facts (so
 * Claude can't hallucinate safe-to-spend numbers) AND echoed back to the
 * client so the UI can render the reasoning trace under the spoken reply.
 *
 * No AI calls. No randomness. Same input → same output, every time.
 */

const DAY = 24 * 60 * 60 * 1000

// ─────────────────────────────────────────────────────────────
// Recurring detection (server-side port of insights.detectRecurring)
// ─────────────────────────────────────────────────────────────

function normaliseMerchant(name = '') {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+(com|nl|eu|be|de|uk|inc|bv)\b/g, '')
    .trim()
    .split(' ').slice(0, 2).join(' ')
}

function detectRecurring(transactions = []) {
  const expenses = transactions.filter(t => Number(t.amount) < 0)
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
    const amounts = group.map(t => Math.abs(Number(t.amount)))
    const avg = amounts.reduce((s, v) => s + v, 0) / amounts.length
    const similar = amounts.every(a => Math.abs(a - avg) / avg < 0.15)
    if (!similar) continue
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

// ─────────────────────────────────────────────────────────────
// Money-amount extraction
// ─────────────────────────────────────────────────────────────

const MONEY_RX = [
  /€\s*([\d]+(?:[.,]\d{1,2})?)/i,
  /(\d+(?:[.,]\d{1,2})?)\s*€/i,
  /(\d+(?:[.,]\d{1,2})?)\s*(?:euros?|eur)\b/i,
  /\bfor\s+(\d+(?:[.,]\d{1,2})?)\b/i,
  /\babout\s+(\d+(?:[.,]\d{1,2})?)\b/i,
  /\baround\s+(\d+(?:[.,]\d{1,2})?)\b/i,
  /\bspend(?:ing)?\s+(\d+(?:[.,]\d{1,2})?)\b/i,
  /\bbuy.*?(\d+(?:[.,]\d{1,2})?)/i,
]

function extractAmountFromText(text = '') {
  if (!text) return null
  for (const rx of MONEY_RX) {
    const m = String(text).match(rx)
    if (m && m[1]) {
      const n = parseFloat(m[1].replace(',', '.'))
      if (Number.isFinite(n) && n > 0 && n < 100_000) return Math.round(n * 100) / 100
    }
  }
  return null
}

// ─────────────────────────────────────────────────────────────
// Payday + burn-rate helpers
// ─────────────────────────────────────────────────────────────

function findLastSalary(transactions = []) {
  return transactions
    .filter(t => Number(t.amount) > 0 && /salary|salaris|loon|payroll|payslip|wage/i.test(t.merchant || t.description || ''))
    .sort((a, b) => new Date(b.date) - new Date(a.date))[0] || null
}

function daysToNextPayday(transactions) {
  const last = findLastSalary(transactions)
  if (!last) return null
  const next = new Date(new Date(last.date).getTime() + 30 * DAY)
  const days = Math.ceil((next.getTime() - Date.now()) / DAY)
  return days >= 0 ? days : null
}

function recentBurn(transactions, days) {
  const since = Date.now() - days * DAY
  return transactions
    .filter(t => Number(t.amount) < 0 && new Date(t.date).getTime() >= since)
    .reduce((s, t) => s + Math.abs(Number(t.amount)), 0)
}

// ─────────────────────────────────────────────────────────────
// Predictive layer — forecast, bill cliff, goal pacing, subs
// ─────────────────────────────────────────────────────────────

function startOfMonth(d = new Date()) { return new Date(d.getFullYear(), d.getMonth(), 1) }
function endOfMonth(d = new Date())   { return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59) }

/**
 * Project end-of-month balance from this month's burn rate.
 * Optionally simulate "what if I bought this thing right now".
 */
function forecastEnd({ transactions = [], totalBalance = 0, addPurchase = 0 } = {}) {
  const now = new Date()
  const mStart = startOfMonth(now)
  const elapsedDays   = Math.max(1, Math.ceil((now - mStart) / DAY))
  const remainingDays = Math.max(0, endOfMonth(now).getDate() - now.getDate())

  const monthExpenses = transactions
    .filter(t => Number(t.amount) < 0 && new Date(t.date) >= mStart)
    .reduce((s, t) => s + Math.abs(Number(t.amount)), 0)
  const monthIncome = transactions
    .filter(t => Number(t.amount) > 0 && new Date(t.date) >= mStart)
    .reduce((s, t) => s + Number(t.amount), 0)

  const dailyBurn   = monthExpenses / elapsedDays
  const projOut     = dailyBurn * remainingDays + Number(addPurchase || 0)
  const projected   = Math.round((totalBalance - projOut) * 100) / 100

  return {
    elapsedDays,
    remainingDays,
    monthIncome:   Math.round(monthIncome),
    monthExpenses: Math.round(monthExpenses),
    dailyBurn:     Math.round(dailyBurn),
    projectedEnd:  projected,
  }
}

/**
 * Bill cliff — surface the earliest *material* upcoming obligation. Material
 * means EITHER:
 *   • the bill alone is ≥20% of current balance and ≥€100 (e.g. rent), OR
 *   • the bill pushes the running balance below the safety buffer.
 *
 * That way rent always surfaces as the cliff even when smaller charges
 * happen to cross the buffer first. We walk chronologically so the soonest
 * material bill wins.
 */
function billCliff({ totalBalance, buffer, upcoming = [] }) {
  if (!upcoming.length) return null
  let running = totalBalance
  let fallback = null
  for (const ob of upcoming) {
    const before  = running
    running       = before - Number(ob.amount || 0)
    const dueIn   = Math.max(0, Math.ceil((new Date(ob.date).getTime() - Date.now()) / DAY))
    const isBig   = Number(ob.amount) >= 100 && Number(ob.amount) >= totalBalance * 0.20
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
    // Hold onto the first upcoming bill in case nothing is "material" — at
    // least the dashboard tile has something to render.
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
 * Goal pacing — at the user's current save rate per goal, when does each
 * goal hit, and how does that compare to its deadline (if any).
 *
 * Save rate = inflow into the goal's "current" over the last 60 days,
 * approximated as pool/days. We don't have explicit goal-funding history,
 * so we use a heuristic: the user's monthly net surplus split evenly
 * across active goals (a reasonable demo proxy that updates with reality).
 */
function goalPacing({ goals = [], transactions = [] }) {
  if (!goals.length) return []
  const now = new Date()
  const mStart = startOfMonth(now)
  const monthIn  = transactions.filter(t => Number(t.amount) > 0 && new Date(t.date) >= mStart)
                               .reduce((s, t) => s + Number(t.amount), 0)
  const monthOut = transactions.filter(t => Number(t.amount) < 0 && new Date(t.date) >= mStart)
                               .reduce((s, t) => s + Math.abs(Number(t.amount)), 0)
  const monthlySurplus = Math.max(0, monthIn - monthOut)
  const active = goals.filter(g => Number(g.current || 0) < Number(g.target || 0))
  const perGoalMonthly = active.length > 0 ? monthlySurplus / active.length : 0

  return goals.map(g => {
    const remaining = Math.max(0, Number(g.target) - Number(g.current))
    const pct = Number(g.target) > 0 ? Math.round((Number(g.current) / Number(g.target)) * 100) : 0
    if (remaining === 0) {
      return { id: g.id, name: g.name, pct, etaMonths: 0, etaDate: null, lateMonths: 0, deadline: g.deadline || null, status: 'reached' }
    }
    const etaMonths = perGoalMonthly > 0 ? remaining / perGoalMonthly : Infinity
    const etaDate   = Number.isFinite(etaMonths)
      ? new Date(now.getTime() + etaMonths * 30 * DAY)
      : null
    let lateMonths = 0, status = 'on-track'
    if (g.deadline && etaDate) {
      const dl = new Date(g.deadline)
      const monthsLate = (etaDate.getTime() - dl.getTime()) / (30 * DAY)
      if (monthsLate > 1) { lateMonths = Math.round(monthsLate); status = 'late' }
      else if (monthsLate > -1) { status = 'tight' }
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

// "Fixed obligations" you can't really cancel — rent, mortgage, utilities,
// insurance, telecom. These are recurring but should NOT be counted as
// subscription bloat (since the answer "cancel it" doesn't apply).
const FIXED_OBLIGATIONS_RX = /\b(rent|huur|mortgage|hypothee|electric|stroom|gas|water|insurance|verzeker|t\s?mobile|vodafone|kpn|ziggo|odido|essent|eneco|vattenfall)\b/i

/**
 * Subscription waste — only counts DISCRETIONARY recurring (entertainment,
 * SaaS, streaming, gym, etc.). Fixed obligations like rent/utilities are
 * deliberately excluded so the total doesn't include €820 of rent and
 * mislead the user into thinking they have "€854 of subscriptions to cut".
 */
function subscriptionWaste(subs = []) {
  if (!subs.length) return null
  const discretionary = subs.filter(s => !FIXED_OBLIGATIONS_RX.test(s.merchant || ''))
  if (!discretionary.length) return null
  const totalMonthly = discretionary.reduce((s, x) => s + Number(x.amount || 0), 0)
  const skippable = /netflix|spotify|disney|youtube|hbo|prime|paramount|apple\s?tv|twitch|patreon|notion|adobe|figma|canva|gym|fitness/i
  const candidate = discretionary
    .filter(s => skippable.test(s.merchant) && Number(s.amount) >= 8)
    .sort((a, b) => Number(b.amount) - Number(a.amount))[0] || null
  const biggest = discretionary.sort((a, b) => Number(b.amount) - Number(a.amount))[0]
  return {
    count: discretionary.length,
    totalMonthly: Math.round(totalMonthly * 100) / 100,
    biggest:   biggest   ? { merchant: biggest.merchant,   amount: Math.round(Number(biggest.amount) * 100) / 100 }   : null,
    candidate: candidate ? { merchant: candidate.merchant, amount: Math.round(Number(candidate.amount) * 100) / 100 } : null,
  }
}

// ─────────────────────────────────────────────────────────────
// Core: build the judgment
// ─────────────────────────────────────────────────────────────

/**
 * @param {object} args
 * @param {object} args.financialContext — same shape the client sends
 * @param {string} args.voiceText        — the raw user request
 * @param {string} args.intent           — IDENTIFY / IDENTIFY_FOLLOWUP / FINANCIAL / etc.
 * @returns {object} judgment
 */
export function buildJudgment({ financialContext: ctx = {}, voiceText = '', intent = '' } = {}) {
  const transactions = Array.isArray(ctx.transactions) ? ctx.transactions : []
  const accounts     = Array.isArray(ctx.accounts) ? ctx.accounts : []
  const goals        = Array.isArray(ctx.goals) ? ctx.goals : []
  const balance      = Number(ctx.totalBalance ?? accounts.reduce((s, a) => s + Number(a.balance || 0), 0))

  // ── Upcoming recurring within next 30 days, sorted by due date ──
  // (Sorting matters: billCliff walks the list in chronological order so
  //  the FIRST obligation that breaches the buffer is what we surface.
  //  A tiny Disney+ charge after rent shouldn't pre-empt the rent itself.)
  const subs = detectRecurring(transactions)
  const horizon = new Date(Date.now() + 30 * DAY)
  const upcomingRaw = []
  let upcomingTotal = 0
  for (const s of subs) {
    const last = new Date(s.lastDate)
    const next = new Date(last.getTime() + 30 * DAY)
    if (next > new Date() && next <= horizon) {
      upcomingRaw.push({
        merchant: s.merchant,
        amount:   Math.round(s.amount * 100) / 100,
        date:     next.toISOString(),
      })
      upcomingTotal += s.amount
    }
  }
  const upcoming = upcomingRaw.sort((a, b) => new Date(a.date) - new Date(b.date))
  upcomingTotal = Math.round(upcomingTotal * 100) / 100

  // ── Safety buffer: €50/account capped at €200 ──
  const buffer = Math.min(200, 50 * Math.max(1, accounts.length))

  // ── Safe-to-spend ──
  const safe = Math.max(0, Math.round(balance - upcomingTotal - buffer))

  // ── Burn-rate this week vs prior week ──
  const thisWeekBurn = Math.round(recentBurn(transactions, 7))
  const prevWeekBurn = Math.round(recentBurn(transactions, 14) - thisWeekBurn)
  const burnRatio    = prevWeekBurn > 30
    ? Math.round((thisWeekBurn / prevWeekBurn) * 100) / 100
    : null

  // ── Days until next payday ──
  const dtp = daysToNextPayday(transactions)

  // ── Closest savings goal that has cushion to pull from ──
  const goalWithCushion = goals
    .filter(g => Number(g.current || 0) >= 25)
    .sort((a, b) => Number(b.current || 0) - Number(a.current || 0))[0] || null

  // ── Determine the requested amount, if any ──
  let requestedAmount = null
  let requestedFor    = null
  if (ctx.identifiedProduct?.priceEstimate) {
    requestedAmount = Math.round(Number(ctx.identifiedProduct.priceEstimate) * 100) / 100
    requestedFor    = ctx.identifiedProduct.name
      ? [ctx.identifiedProduct.brand, ctx.identifiedProduct.name].filter(Boolean).join(' ').trim()
      : 'this'
  } else {
    const fromVoice = extractAmountFromText(voiceText)
    if (fromVoice) {
      requestedAmount = fromVoice
      requestedFor    = 'this'
    }
  }

  // ── Verdict ──
  let verdict = 'general-good'
  let headroom = null
  if (requestedAmount != null) {
    headroom = Math.round((safe - requestedAmount) * 100) / 100
    if      (requestedAmount <= safe * 0.6) verdict = 'easy'
    else if (requestedAmount <= safe)        verdict = 'tight'
    else                                     verdict = 'over'
  } else {
    if (safe < 50)                          verdict = 'general-tight'
    else if (burnRatio && burnRatio > 1.4)  verdict = 'general-spike'
  }

  // ── Should we even consider "split it" as an alternative? ──
  //
  // Splitting only makes sense when the purchase is INHERENTLY shared:
  // a restaurant bill, a group activity, a shared subscription, etc.
  // It's nonsensical for personal goods (a phone, shoes, headphones).
  // We only allow SPLIT_WITH when the intent is a receipt OR the product
  // category is dining/group OR the user's voice text explicitly mentions
  // splitting. Otherwise: never suggest it.
  const productCategory = (ctx.identifiedProduct?.category || '').toLowerCase()
  const splittableCategories = /(dining|food|restaurant|bar|cafe|grocer|takeaway|delivery|drinks|nightlife|event|ticket|travel|hotel)/i
  const userMentionedSplit = /\bsplit|share|together|group|friends|with\s+(my|the)\s+(friends|roommate|partner|girlfriend|boyfriend)\b/i.test(voiceText || '')
  const isReceiptIntent    = String(intent || '').toUpperCase() === 'RECEIPT'
  const splitMakesSense    = isReceiptIntent || splittableCategories.test(productCategory) || userMentionedSplit

  // ── Concrete alternatives when over / tight ──
  const alternatives = []
  if (verdict === 'over' && requestedAmount != null) {
    const shortfall = Math.round((requestedAmount - safe) * 100) / 100
    if (goalWithCushion && Number(goalWithCushion.current) >= shortfall) {
      alternatives.push({
        type: 'PULL_FROM_GOAL',
        label: `Pull €${shortfall.toFixed(2)} from ${goalWithCushion.name}`,
        amount: shortfall,
        goalId: goalWithCushion.id,
        goalName: goalWithCushion.name,
      })
    }
    if (dtp != null && dtp <= 14) {
      alternatives.push({
        type: 'WAIT_FOR_PAYDAY',
        label: `Wait ${dtp} day${dtp === 1 ? '' : 's'} for payday`,
        days: dtp,
      })
    }
    if (splitMakesSense) {
      alternatives.push({
        type: 'SPLIT_WITH',
        label: `Split it with someone — €${(requestedAmount / 2).toFixed(2)} each`,
        perPerson: Math.round((requestedAmount / 2) * 100) / 100,
      })
    }
    // If the only available alternative for an OVER verdict is "wait", offer
    // a smaller-target suggestion as well so the user sees a path forward.
    if (alternatives.length === 0 || (alternatives.length === 1 && alternatives[0].type === 'WAIT_FOR_PAYDAY')) {
      const safeBudget = Math.max(0, Math.round(safe * 100) / 100)
      if (safeBudget >= 20) {
        alternatives.push({
          type: 'CHEAPER_OPTION',
          label: `Stick to about €${safeBudget.toFixed(0)} — within your safe-to-spend`,
          amount: safeBudget,
        })
      }
    }
  } else if (verdict === 'tight' && requestedAmount != null) {
    if (goalWithCushion) {
      const cushion = Math.min(Number(goalWithCushion.current), Math.round(requestedAmount * 0.4))
      if (cushion >= 10) {
        alternatives.push({
          type: 'PULL_FROM_GOAL',
          label: `Move €${cushion} from ${goalWithCushion.name} for cushion`,
          amount: cushion,
          goalId: goalWithCushion.id,
          goalName: goalWithCushion.name,
        })
      }
    }
    if (dtp != null && dtp <= 7) {
      alternatives.push({
        type: 'WAIT_FOR_PAYDAY',
        label: `${dtp} day${dtp === 1 ? '' : 's'} until payday — wait it out?`,
        days: dtp,
      })
    }
  }

  // ── Predictive layer: forecast / cliff / pacing / subs ──
  const forecast      = forecastEnd({ transactions, totalBalance: balance })
  const forecastIfBuy = requestedAmount != null
    ? forecastEnd({ transactions, totalBalance: balance, addPurchase: requestedAmount })
    : null
  const cliff         = billCliff({ totalBalance: balance, buffer, upcoming })
  const pacing        = goalPacing({ goals, transactions })
  const subBloat      = subscriptionWaste(subs)

  // ── Human-readable reasoning lines (for the UI trace + the prompt) ──
  const reasoning = []
  reasoning.push({ label: 'Balance', value: `€${balance.toFixed(2)}` })
  reasoning.push({ label: 'Bills due (30d)', value: `−€${upcomingTotal.toFixed(2)}`, detail: upcoming.slice(0, 3).map(u => `${u.merchant} €${u.amount.toFixed(2)}`).join(' · ') || null })
  reasoning.push({ label: 'Safety buffer', value: `−€${buffer.toFixed(2)}` })
  reasoning.push({ label: 'Safe to spend', value: `€${safe.toFixed(2)}`, emphasise: true })
  if (requestedAmount != null) {
    reasoning.push({ label: 'This purchase', value: `−€${requestedAmount.toFixed(2)}`, detail: requestedFor })
    reasoning.push({
      label: 'After purchase',
      value: `${headroom >= 0 ? '€' : '−€'}${Math.abs(headroom).toFixed(2)}`,
      emphasise: true,
      tone: headroom < 0 ? 'over' : headroom < 50 ? 'tight' : 'easy',
    })
    // What-if forecast — landing balance with vs without the purchase
    if (forecastIfBuy && forecast.remainingDays > 0) {
      const delta = Math.abs(Math.round(forecastIfBuy.projectedEnd - forecast.projectedEnd))
      const horizon = dtp != null ? 'payday' : 'month-end'
      reasoning.push({
        label: `By ${horizon} with this`,
        value: `${forecastIfBuy.projectedEnd >= 0 ? '€' : '−€'}${Math.abs(forecastIfBuy.projectedEnd).toFixed(0)}`,
        detail: `€${delta} less than if you skipped it (you'd land at €${forecast.projectedEnd.toFixed(0)} otherwise)`,
        tone: forecastIfBuy.projectedEnd < buffer ? 'over' : forecastIfBuy.projectedEnd < buffer + 100 ? 'tight' : 'easy',
      })
    }
  }
  // Bill-cliff alert — only shown when there's an actual breach
  if (cliff && cliff.dueIn <= 14) {
    reasoning.push({
      label: `${cliff.merchant} in ${cliff.dueIn}d`,
      value: `−€${cliff.amount.toFixed(0)}`,
      detail: cliff.balanceAfter < buffer
        ? `Drops to €${cliff.balanceAfter.toFixed(0)} — ${cliff.breachAmount > 0 ? `€${cliff.breachAmount.toFixed(0)} short of buffer` : 'right on the buffer'}`
        : null,
      tone: 'over',
    })
  }
  if (dtp != null) {
    reasoning.push({ label: 'Days to payday', value: `${dtp}d`, tone: 'info' })
  }
  if (burnRatio != null && burnRatio > 1.3) {
    reasoning.push({
      label: 'Spend trend',
      value: `${Math.round((burnRatio - 1) * 100)}% above last week`,
      tone: 'tight',
    })
  }

  return {
    balance,
    upcomingRecurring: upcomingTotal,
    upcoming,                 // [{ merchant, amount, date }]
    buffer,
    safeToSpend: safe,
    daysToPayday: dtp,
    weeklyBurn: { current: thisWeekBurn, prior: prevWeekBurn, ratio: burnRatio },
    goalWithCushion: goalWithCushion ? {
      id: goalWithCushion.id, name: goalWithCushion.name, current: Number(goalWithCushion.current || 0),
    } : null,
    requestedAmount,
    requestedFor,
    headroom,
    verdict,
    alternatives,
    forecast,            // { elapsedDays, remainingDays, dailyBurn, projectedEnd, monthIncome, monthExpenses }
    forecastIfBuy,       // same shape, with the purchase added to projected spend (or null)
    billCliff: cliff,    // { merchant, amount, dueDate, dueIn, balanceAfter, breachAmount } | null
    goalPacing: pacing,  // [{ id, name, pct, etaMonths, etaDate, deadline, lateMonths, status }]
    subscriptionBloat: subBloat,  // { count, totalMonthly, biggest, candidate } | null
    reasoning,
  }
}

// ─────────────────────────────────────────────────────────────
// Prompt formatter — turns the judgment into an authoritative
// block Claude must use verbatim instead of inventing numbers.
// ─────────────────────────────────────────────────────────────

export function judgmentToPromptBlock(j) {
  if (!j) return ''
  const lines = []
  lines.push('═══ FINANCIAL JUDGMENT (authoritative — use these numbers, do not invent) ═══')
  lines.push(`Balance:           €${j.balance.toFixed(2)}`)
  lines.push(`Bills due (30d):   €${j.upcomingRecurring.toFixed(2)}${j.upcoming.length ? ` (${j.upcoming.slice(0, 3).map(u => `${u.merchant} €${u.amount.toFixed(2)}`).join(', ')})` : ''}`)
  lines.push(`Safety buffer:     €${j.buffer.toFixed(2)}`)
  lines.push(`Safe to spend:     €${j.safeToSpend.toFixed(2)}`)
  if (j.daysToPayday != null) lines.push(`Days to payday:    ${j.daysToPayday}`)
  if (j.weeklyBurn?.ratio && j.weeklyBurn.ratio > 1.3) {
    lines.push(`Weekly spend:      ${Math.round((j.weeklyBurn.ratio - 1) * 100)}% above last week`)
  }
  if (j.requestedAmount != null) {
    lines.push(`Requested amount:  €${j.requestedAmount.toFixed(2)}${j.requestedFor && j.requestedFor !== 'this' ? ` (${j.requestedFor})` : ''}`)
    lines.push(`Headroom after:    €${j.headroom.toFixed(2)} ${j.headroom < 0 ? '(OVER safe-to-spend)' : j.headroom < 50 ? '(TIGHT)' : '(comfortable)'}`)
  }
  // ── Forecast & what-if ──
  if (j.forecast && j.forecast.remainingDays > 0) {
    lines.push(`Month-end forecast: €${j.forecast.projectedEnd.toFixed(0)} (€${j.forecast.dailyBurn}/day burn, ${j.forecast.remainingDays}d left)`)
    if (j.forecastIfBuy && j.requestedAmount != null) {
      lines.push(`If you buy it now:  €${j.forecastIfBuy.projectedEnd.toFixed(0)} by month-end (Δ €${Math.round(j.forecastIfBuy.projectedEnd - j.forecast.projectedEnd)})`)
    }
  }
  // ── Bill cliff (urgent committed obligation) ──
  if (j.billCliff && j.billCliff.dueIn <= 14) {
    const c = j.billCliff
    if (c.balanceAfter < j.buffer) {
      lines.push(`BILL CLIFF: ${c.merchant} due in ${c.dueIn} day${c.dueIn === 1 ? '' : 's'} (€${c.amount.toFixed(0)}) — drops you to €${c.balanceAfter.toFixed(0)}, ${c.breachAmount > 0 ? `€${c.breachAmount.toFixed(0)} below buffer` : 'right at buffer'}`)
    } else {
      lines.push(`Next bill: ${c.merchant} in ${c.dueIn}d (€${c.amount.toFixed(0)}) — covered`)
    }
  }
  // ── Goal pacing (only flag late or stalled goals) ──
  const lateGoals = (j.goalPacing || []).filter(p => p.status === 'late' || p.status === 'stalled')
  if (lateGoals.length) {
    lateGoals.slice(0, 2).forEach(p => {
      if (p.status === 'stalled') {
        lines.push(`Goal stalled: ${p.name} — no surplus this month, ${p.pct}% there.`)
      } else {
        lines.push(`Goal off-pace: ${p.name} — ETA ${p.etaDate || 'unknown'}, ${p.lateMonths} month${p.lateMonths === 1 ? '' : 's'} past deadline.`)
      }
    })
  }
  // ── Subscription bloat (only when meaningful) ──
  if (j.subscriptionBloat && j.subscriptionBloat.count >= 3 && j.subscriptionBloat.totalMonthly >= 30) {
    lines.push(`Subscriptions: ${j.subscriptionBloat.count} recurring, €${j.subscriptionBloat.totalMonthly.toFixed(0)}/mo total${j.subscriptionBloat.candidate ? ` (${j.subscriptionBloat.candidate.merchant} €${j.subscriptionBloat.candidate.amount} is the obvious cancel candidate)` : ''}`)
  }
  lines.push(`Verdict:           ${j.verdict.toUpperCase()}`)
  if (j.goalWithCushion) {
    lines.push(`Goal with cushion: ${j.goalWithCushion.name} has €${j.goalWithCushion.current.toFixed(2)} parked`)
  }
  if (j.alternatives.length) {
    lines.push('Pre-computed safe alternatives (offer ONE, the most fitting):')
    j.alternatives.forEach(a => lines.push(`  • ${a.label}`))
  }
  lines.push('RULE: Use the numbers above literally. Do NOT compute your own safe-to-spend or buffer. If the verdict is OVER, you must NOT say it fits comfortably.')
  lines.push('═══ END JUDGMENT ═══')
  return lines.join('\n')
}
