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
// THE INPUT THAT DECIDES EVERYTHING: HOW FAST A FRESH LIFE EARNS.
//
// The first version fed trajectory.incomeModel a fresh-start income of
// $400k/s; measured on 2026-09-24, a fresh life earned ~$0.2k-9k/s for its
// first several minutes against $11.87m/s at maturity — the batcher restarts,
// servers regrow from 4% of max, hacking relevels. A 100x-optimistic ramp is
// what made one-ticket installs look optimal.
//
// The second version measured it instead: the median of the node's completed
// lives in tel.js's ledger (ns.getMoneySources().sinceInstall, zeroed at every
// install), and REFUSED until three were recorded — "only N completed
// life/lives recorded in BitNode 9 (need 3) — the fresh ramp is not yet
// measured" — so the count batch sat on COUNT_MIN_BATCH for the first three
// lives of every node, the lives where the count matters most.
//
// Now the curve is a STRUCTURAL PRIOR with the lives as evidence (freshCurve's
// `prior`): the exit model's fresh-life money (lifeplan.freshLifeMoney — the
// hacking stream from the game's formulas, freshlife.js, beside the trader's
// compounding and the flat streams) from the install on, times a scale whose
// posterior the node's completed lives update (bayes.formulaErrorPosterior on
// ln(earned / prior) per life, Student-t: a windfall life is down-weighted,
// not a median's accident). No life: the prior as it stands, said so. Nothing
// switches from the prior to the measured.
//
// Batch cost is priced in the optimal order (most expensive first). augplan's
// DP already buys tickets that way — this was checked, after a claim that it
// did not turned out to be wrong.
// ---------------------------------------------------------------------------
import { formulaErrorPosterior } from 'bayes.js'

const num = (v) => typeof v === 'number' && isFinite(v)


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
 * THE FRESH-LIFE EARNINGS CURVE: a structural prior, scaled by the lives.
 *
 * `o.prior` {moneyBy(h), why}: money a fresh life has earned by age h (from
 * the install), the model's (progress.js: lifeplan.freshLifeMoney on the exit
 * inputs). `ledger.lives` maps a life's lastAugReset to `{node, complete,
 * samples: [[ageH, earned], ...]}`; each COMPLETED life in `node` gives
 * y = ln(earned at its last sample / prior at that age), its hours that age.
 * The scale is exp(posterior mean) of bayes.formulaErrorPosterior (kind
 * 'count', this node's lives only: the prior is this node's model), so it
 * moves with every life, by the life's weight, from 1.
 *
 * Returns `{ moneyBy(h), lives, scale, sd, weight, why }`, or `{ moneyBy:
 * null, why }` when no prior is supplied — refused as UNPRICED, never a
 * guess. Monotone by construction (the prior is).
 */
export function freshCurve(ledger, node, o = {}) {
  const prior = o.prior
  if (!prior || typeof prior.moneyBy !== 'function') return { moneyBy: null, lives: 0, why: `no fresh-life model supplied for BitNode ${node} — the timing is unpriced` }
  const lives = Object.entries(ledger?.lives ?? {}).filter(([, L]) => L && L.node === node && L.complete === true && Array.isArray(L.samples) && L.samples.length >= 2)
  const res = []
  for (const [k, L] of lives) {
    const pts = L.samples.filter((p) => Array.isArray(p) && num(p[0]) && num(p[1])).sort((a, b) => a[0] - b[0])
    if (pts.length < 2) continue
    const end = pts[pts.length - 1]
    const earned = Math.max(0, ...pts.map((p) => p[1]))
    const model = prior.moneyBy(end[0])
    if (earned > 0 && model > 0 && end[0] > 0) res.push({ ln: Math.log(earned / model), hours: end[0], node, life: k })
  }
  const post = formulaErrorPosterior(res, 'count', { node })
  const scale = Math.exp(post.mean)
  const moneyBy = (h) => (h > 0 ? Math.max(0, prior.moneyBy(h)) * scale : 0)
  return {
    moneyBy,
    lives: res.length,
    scale,
    sd: post.sd,
    weight: post.weight,
    why: `fresh-life money model x${scale.toFixed(2)} (${res.length} completed BitNode ${node} li${res.length === 1 ? 'fe' : 'ves'} carry ${Math.round(100 * post.weight)}% of the scale; one life x/÷ ${Math.exp(1.2816 * post.sd).toFixed(1)} at 80%) — ${prior.why ?? 'the model'}`,
  }
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
 * installNow is NULL when no curve could be built (no fresh-life model); the
 * caller must fall back and say so rather than read null as either answer.
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
  if (!curve || typeof curve.moneyBy !== 'function') return refuse(curve?.why ?? 'no fresh-life curve supplied')

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
