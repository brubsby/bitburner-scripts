// WHEN TO INSTALL A COUNT BATCH — priced against measured lives, not a floor.
//
// Daedalus needs N distinct augmentations and they count only once INSTALLED.
// Each install resets money, so banking the remaining count is a question of
// how to PARTITION it into batches: fewer, bigger batches pay the per-purchase
// escalation (the j-th purchase of a cycle costs `base * r^j`, r = 1.9) on more
// tickets at once; more, smaller batches pay a fresh life's slow ramp more
// often. installgate.js answered it with COUNT_MIN_BATCH = 3, stated in its own
// comment as "a policy, not a proof". This is the proof — when it can be one.
//
// ---------------------------------------------------------------------------
// WHY A FINITE-HORIZON DP, AND NOT THE RENEWAL RULE IT FIRST WAS.
//
// The first version used the multiplier gate's rule in count units: install
// when the marginal rate of waiting for one more ticket falls below the best
// AVERAGE rate a fresh life sustains. That rule is right for a process that
// repeats forever. This one does not: there are ~11 tickets left and each is
// CONSUMED. A fresh life's "best rate" re-used the cheapest ticket every time,
// so it concluded "install after every single ticket" at 80 tickets/h — while
// the second life would in fact face the second-cheapest ticket, not the first.
//
// So it is a partition problem over a depleting pool: state i = the cheapest i
// tickets banked; from a fresh life, the next batch takes the next b cheapest.
// DP[i] = min over b of (hours a fresh life needs to afford that batch) +
// DP[i+b]. Eleven tickets is 66 transitions.
//
// ---------------------------------------------------------------------------
// THE INPUT THAT DECIDES EVERYTHING, AND WHY IT MUST BE MEASURED.
//
// How fast a FRESH life earns. The first version fed trajectory.incomeModel a
// fresh-start income of $400k/s; measured on 2026-09-24, a fresh life earned
// ~$0.2k-9k/s for its first several minutes against $11.87m/s at maturity —
// the batcher restarts, servers regrow from 4% of max, hacking relevels. A
// 100x-optimistic ramp is what made one-ticket installs look optimal, and a
// policy built on it would thrash through a ramp every few minutes.
//
// So the curve comes from `ns.getMoneySources().sinceInstall` — gross earnings
// since the last install, which the game zeroes on every install
// (PlayerObjectGeneralMethods.ts:128) and which spending cannot corrupt, unlike
// the money balance. tel.js records it as a per-life ledger. Until enough
// completed lives are recorded, this REFUSES (installNow: null) and the gate
// falls back to the floor, saying so. An uncalibrated model driving an
// irreversible install is precisely the failure CLAUDE.md is written against.
//
// Batch cost is priced in the optimal order (most expensive first). augplan's
// DP already buys tickets that way — this was checked, after a claim that it
// did not turned out to be wrong.
// ---------------------------------------------------------------------------
const num = (v) => typeof v === 'number' && isFinite(v)

/** Completed lives needed before the curve is trusted to drive an install. */
export const MIN_LIVES = 3

/** Cost of buying these prices in one cycle, most expensive first (optimal). */
export function batchCost(prices, r) {
  if (!Array.isArray(prices) || !num(r) || r < 1) return null
  if (!prices.every((p) => num(p) && p >= 0)) return null
  return [...prices].sort((a, b) => b - a).reduce((sum, p, i) => sum + p * Math.pow(r, i), 0)
}

/**
 * Hours until the monotone `moneyBy(h)` reaches `need`, by bisection.
 * 0 if already there, Infinity if never inside `maxH`, null on bad input.
 */
export function hoursToAfford(need, moneyBy, maxH = 200) {
  if (!num(need) || typeof moneyBy !== 'function') return null
  if (need <= 0) return 0
  const top = moneyBy(maxH)
  if (!num(top)) return null
  if (top < need) return Infinity
  let lo = 0
  let hi = maxH
  for (let i = 0; i < 80 && hi - lo > 1e-7; i++) {
    const mid = (lo + hi) / 2
    if (moneyBy(mid) >= need) hi = mid
    else lo = mid
  }
  return hi
}

/**
 * THE FRESH-LIFE EARNINGS CURVE, from recorded lives.
 *
 * `ledger.lives` maps a life's lastAugReset to `{node, complete, samples:
 * [[ageH, earned], ...]}`. Only COMPLETED lives in `node` are used — a life in
 * progress has not shown its tail. At each age the curve is the MEDIAN of the
 * lives that reached it, which is what keeps one odd life (a contract windfall,
 * a sleep) from bending the whole policy.
 *
 * Returns `{ moneyBy(h), lives, horizonH }` or `{ moneyBy: null, why }`.
 * Past the longest recorded life it extends at that life's final slope — and
 * reports `horizonH` so a caller can see where measurement stops.
 */
export function freshCurve(ledger, node, o = {}) {
  const need = num(o.minLives) ? o.minLives : MIN_LIVES
  const lives = Object.values(ledger?.lives ?? {}).filter(
    (L) => L && L.node === node && L.complete === true && Array.isArray(L.samples) && L.samples.length >= 2,
  )
  if (lives.length < need) {
    return { moneyBy: null, lives: lives.length, why: `only ${lives.length} completed life/lives recorded in BitNode ${node} (need ${need}) — the fresh ramp is not yet measured` }
  }
  // Each life as a monotone piecewise-linear function of age.
  const fns = lives.map((L) => {
    const pts = L.samples.filter((p) => Array.isArray(p) && num(p[0]) && num(p[1])).sort((a, b) => a[0] - b[0])
    let hi = 0
    for (const p of pts) hi = p[1] = Math.max(hi, p[1]) // enforce monotone
    return { pts, end: pts[pts.length - 1][0] }
  })
  const at = (f, h) => {
    const { pts } = f
    if (h <= pts[0][0]) return pts[0][1] * (pts[0][0] > 0 ? Math.max(0, h) / pts[0][0] : 1)
    for (let i = 1; i < pts.length; i++) {
      if (h <= pts[i][0]) {
        const [a0, e0] = pts[i - 1]
        const [a1, e1] = pts[i]
        return e0 + ((e1 - e0) * (h - a0)) / (a1 - a0 || 1)
      }
    }
    const n = pts.length
    const slope = (pts[n - 1][1] - pts[n - 2][1]) / (pts[n - 1][0] - pts[n - 2][0] || 1)
    return pts[n - 1][1] + slope * (h - pts[n - 1][0])
  }
  const horizonH = Math.max(...fns.map((f) => f.end))
  const moneyBy = (h) => {
    if (!(h > 0)) return 0
    const v = fns.map((f) => at(f, h)).sort((a, b) => a - b)
    const m = v.length >> 1
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
  }
  return { moneyBy, lives: lives.length, horizonH, why: `median of ${lives.length} completed BitNode ${node} lives, measured to ${horizonH.toFixed(1)}h` }
}

/**
 * THE OPTIMAL PARTITION of the remaining count, from fresh lives.
 * pool: remaining ticket prices (any order). Returns { hours, batches } where
 * DP[i] is the best total hours to bank tickets i..remaining-1.
 */
export function planBatches({ pool, r, remaining, freshMoneyBy, freshStart = 0 }) {
  const P = [...pool].filter((p) => num(p) && p >= 0).sort((a, b) => a - b)
  const n = Math.min(P.length, num(remaining) && remaining > 0 ? remaining : P.length)
  if (!n) return { hours: 0, batches: [], DP: [0] }
  const DP = new Array(n + 1).fill(Infinity)
  const choice = new Array(n + 1).fill(0)
  DP[n] = 0
  for (let i = n - 1; i >= 0; i--) {
    for (let b = 1; i + b <= n; b++) {
      const cost = batchCost(P.slice(i, i + b), r)
      const h = hoursToAfford(cost - freshStart, freshMoneyBy)
      if (h === null) return null
      if (!isFinite(h)) break // costlier batches are unaffordable too
      const t = h + DP[i + b]
      if (t < DP[i]) {
        DP[i] = t
        choice[i] = b
      }
    }
  }
  const batches = []
  for (let i = 0; i < n && choice[i] > 0; i += choice[i]) batches.push(choice[i])
  return { hours: DP[0], batches, DP, pool: P.slice(0, n) }
}

/**
 * INSTALL THIS COUNT BATCH NOW, OR KEEP ADDING TO IT THIS LIFE?
 *
 * Holding `kNow` affordable tickets at life age `ageH` with `moneyNow`:
 *   install now  -> DP[kNow]                       (the rest from fresh lives)
 *   wait for k   -> wait(k) + DP[k], k > kNow      (this life earns the gap)
 * where wait(k) is how long THIS life — the same measured curve, shifted to its
 * current age — needs to earn batchCost(k) - moneyNow. Install iff no wait wins.
 *
 * installNow is NULL when the curve is not yet measured; the caller must fall
 * back and say so rather than read null as either answer.
 */
export function countTiming(o = {}) {
  const { prices, r, kNow, remaining, moneyNow, ageH, curve } = o
  const freshStart = num(o.freshStart) && o.freshStart >= 0 ? o.freshStart : 0
  const refuse = (why) => ({ installNow: null, why })
  if (!Array.isArray(prices)) return refuse('no ticket prices supplied')
  if (!num(r) || r < 1) return refuse('price multiplier unreadable')
  if (!num(kNow) || kNow < 0) return refuse('current batch size unreadable')
  if (!num(remaining) || remaining < 0) return refuse('remaining count unreadable')
  if (!num(moneyNow) || moneyNow < 0) return refuse('money unreadable')
  if (!num(ageH) || ageH < 0) return refuse('life age unreadable')
  if (!curve || typeof curve.moneyBy !== 'function') return refuse(curve?.why ?? 'no measured fresh-life curve')

  if (kNow < 1) return { installNow: false, why: 'nothing in the batch yet' }
  const P = [...prices].filter((p) => num(p) && p >= 0).sort((a, b) => a - b)
  if (kNow >= remaining) return { installNow: true, reason: 'finishes', why: `the ${kNow} ticket(s) in hand finish the gate (${remaining} needed) — nothing is gained by waiting` }
  if (kNow >= P.length) return { installNow: true, reason: 'exhausted', why: `every obtainable ticket (${P.length}) is already in the batch — waiting cannot add one` }

  const fresh = planBatches({ pool: P, r, remaining, freshMoneyBy: curve.moneyBy, freshStart })
  if (!fresh) return refuse('the remaining count could not be partitioned')
  const DP = fresh.DP
  const nowBy = (h) => curve.moneyBy(ageH + h) - curve.moneyBy(ageH)

  const installH = DP[kNow]
  let best = { k: kNow, total: installH, wait: 0 }
  const cap = Math.min(P.length, remaining)
  for (let k = kNow + 1; k <= cap; k++) {
    const w = hoursToAfford(batchCost(P.slice(0, k), r) - moneyNow, nowBy)
    if (w === null) return refuse('the wait for a larger batch could not be priced')
    if (!isFinite(w)) break
    const total = w + DP[k]
    if (total < best.total) best = { k, total, wait: w }
  }
  const installNow = best.k === kNow
  return {
    installNow,
    reason: installNow ? 'install-beats-every-wait' : 'a-bigger-batch-is-faster',
    installHours: installH,
    bestK: best.k,
    bestTotal: best.total,
    bestWait: best.wait,
    plan: fresh.batches,
    curveWhy: curve.why,
    why: installNow
      ? `install ${kNow} now: the remaining ${remaining - kNow} then take ${installH.toFixed(2)}h from fresh lives, and no bigger batch this life beats that (curve: ${curve.why})`
      : `wait for ${best.k}: ${best.wait.toFixed(2)}h more this life, then ${(best.total - best.wait).toFixed(2)}h for the rest = ${best.total.toFixed(2)}h, vs ${installH.toFixed(2)}h installing ${kNow} now (curve: ${curve.why})`,
  }
}
