// The forecast layer's scorekeeper. Pure, no ns.
//
// ---------------------------------------------------------------------------
// WHY
//
// Every model in this stack predicts — ladder ETAs, join forecasts, hold
// candidates, window cycles — and until this module exactly ONE prediction
// was ever scored against reality (income's actualOverPredicted). The cost
// was found the embarrassing way: the pipeline ran on the dated fallback
// g = 1.034/install while its own ledger had already measured 1.213, because
// a min-3-samples guard silently substituted the stale constant — every
// ladder ETA in the system overstated several-fold, and nothing said so.
//
// Two principles, both learned from that:
//
//   A YOUNG MEASUREMENT OUTRANKS AN OLD CONSTANT. Two ledger entries is one
//   real delta; refusing it for an arbitrary sample minimum re-creates the
//   stale-default bug with extra steps.
//
//   A BINDING GUARD MUST BE LOUD. Clamps and fallbacks are fine; silently
//   substituting is not. Everything here returns `meta` naming which arm
//   produced each number and whether any clamp is binding.
//
// ---------------------------------------------------------------------------
// HOW SCORING WORKS
//
// The lifetimes ledger is written once per install — the only moment a
// life's true duration, final multiplier and aug count are all knowable. So
// each entry CARRIES the pipeline's predictions for the NEXT entry (made
// from the very numbers the schedule priced with), and the next install
// scores them. The three quantities scored — multiplier growth, window
// length, augs per window — are the DRIVERS every ladder ETA derives from,
// so a drifting ratio here is a drifting ETA everywhere, visible within one
// install instead of whenever someone thinks to look.

/** Lower median: with few samples, prefer the SHORTER window — overstating
 *  the window makes every ladder look optimistic, the costly direction. */
const lowerMedian = (xs) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)]

/** Fallbacks, dated. MEASURED 2026-09-15 and self-replacing from the first
 *  real ledger delta — they exist so the very first life prices at all. */
const FALLBACK = { windowH: 1.72, g: 1.034 }
const G_CLAMP = 1.5 // a mid-run aug spree can spike one ratio; 1.2 sat ON the real regime and bound

/**
 * The window inputs, measured from the ledger — with meta that names every
 * substitution. `windowH`/`g` always come back usable; `augsPerWindow` is
 * absent until measurable (joinplan's count forecast refuses without it,
 * correctly).
 */
export function measureFromLedger(ledger) {
  const entries = Array.isArray(ledger) ? ledger : []
  const meta = { windowSource: 'fallback', gSource: 'fallback', gClampBinding: false, samples: entries.length }
  const out = { windowH: FALLBACK.windowH, rateGrowthPerCycle: FALLBACK.g }

  // RECENT lives only. The full-ledger median trailed a regime shift by a
  // day: after the flywheel completed, lives collapsed from 1.9-6.9h to
  // 1.0-1.6h, and the old 6.92h entry kept dragging the median up — at one
  // install the median moved the WRONG direction (4.50 became the median as
  // reality shrank to 1.5h; scored 0.444). Eight lives is enough for a
  // median and few enough to cross a regime change within a half-day.
  const lives = entries
    .slice(-8)
    .map((e) => e?.lifeH)
    .filter((h) => typeof h === 'number' && isFinite(h) && h > 0)
  if (lives.length >= 2) {
    out.windowH = lowerMedian(lives)
    meta.windowSource = 'measured'
  }

  // THE SCOREKEEPER CLOSES ITS OWN LOOP. The ledger carries actual/predicted
  // per family; a persistent bias in the window forecast is therefore
  // measurable — so apply it. The correction is the rolling geometric mean
  // of the lifeH scores, clamped to [0.6, 1.4] with the binding state
  // published: an unclamped correction could chase its own tail, and a
  // binding clamp must be loud like every other guard here. When forecasts
  // are calibrated the factor sits at 1 and this is a no-op.
  const lifeScores = entries.map((e) => e?.scores?.lifeH).filter((v) => typeof v === 'number' && isFinite(v) && v > 0)
  if (meta.windowSource === 'measured' && lifeScores.length >= 3) {
    const geo = Math.exp(lifeScores.reduce((a, v) => a + Math.log(v), 0) / lifeScores.length)
    const bias = Math.min(1.4, Math.max(0.6, geo))
    meta.windowBias = Math.round(bias * 1000) / 1000
    meta.windowBiasClampBinding = geo < 0.6 || geo > 1.4
    out.windowH = out.windowH * bias
  }

  const mults = entries
    .slice(-8)
    .map((e) => e?.hackMult)
    .filter((m) => typeof m === 'number' && isFinite(m) && m > 0)
  if (mults.length >= 2) {
    const raw = Math.pow(mults[mults.length - 1] / mults[0], 1 / (mults.length - 1))
    if (isFinite(raw) && raw > 0) {
      meta.gRaw = Math.round(raw * 1000) / 1000
      meta.gClampBinding = raw > G_CLAMP
      out.rateGrowthPerCycle = Math.min(G_CLAMP, Math.max(1, raw))
      meta.gSource = 'measured'
    }
  }

  const augs = entries.map((e) => e?.augs).filter((a) => typeof a === 'number' && isFinite(a) && a >= 0)
  if (augs.length >= 2 && augs[augs.length - 1] > augs[0]) {
    out.augsPerWindow = (augs[augs.length - 1] - augs[0]) / (augs.length - 1)
    meta.augsSource = 'measured'
  }

  out.windowMeta = meta
  return out
}

/**
 * Build one ledger entry at install time: the life's realized figures, the
 * pipeline's predictions for the NEXT entry (made from the numbers it
 * actually priced with this pass), and the SCORES of the previous entry's
 * predictions. A missing prior prediction scores nothing — absence of a
 * score means "no prediction was on record", never "checked and fine".
 */
export function installRecord(prev, actual, used = {}) {
  const num = (x) => typeof x === 'number' && isFinite(x) && x > 0
  const entry = { ...actual }
  const p = { }
  if (num(actual.hackMult) && num(used.g)) p.nextMult = actual.hackMult * used.g
  if (num(used.windowH)) p.nextLifeH = used.windowH
  if (num(actual.augs) && num(used.augsPerWindow)) p.nextAugs = actual.augs + used.augsPerWindow
  if (Object.keys(p).length) entry.predicted = p

  // SCORES DO NOT CROSS BITNODES.
  //
  // A forecast is only wrong if it was wrong about the world it was made in.
  // The previous entry's `predicted` was computed from the multipliers, server
  // money and experience rates of ITS node, and scoring it against a life in a
  // different one measures the BitNode, not the forecaster.
  //
  // Live, the first entry after leaving BitNode 4 scored `mult: 0.046` and
  // `lifeH: 23.354` — read naively that says the drivers are wrong by a factor
  // of twenty, and it is really just 1.16/25.382: a BitNode 4 prediction
  // against a BitNode 1 life, where every multiplier had been reset to SF1's
  // 1.16. Those numbers then feed ledgerScores, whose geometric means the
  // forecasts are calibrated against, so one node change poisons the drift line
  // for the twenty entries it takes to age out.
  //
  // An entry with no `bitNode` predates the field and is refused rather than
  // assumed to match — the same rule achievableRate applies, for the same
  // reason: unknown is not equal.
  const sameNode =
    typeof actual.bitNode === 'number' && typeof prev?.bitNode === 'number' && actual.bitNode === prev.bitNode
  const pp = sameNode ? prev?.predicted : null
  if (pp) {
    const scores = {}
    if (num(pp.nextMult) && num(actual.hackMult)) scores.mult = +(actual.hackMult / pp.nextMult).toFixed(3)
    // The family key is `lifeH`, NOT `window`: the game's RAM checker
    // charges 25GB (RamCostConstants.Dom) for any script whose AST contains
    // the bare identifier `window` — including as a property name — and this
    // pure module rode along in progress.js's import graph at +25GB before
    // the daemon's push log gave it away.
    if (num(pp.nextLifeH) && num(actual.lifeH)) scores.lifeH = +(actual.lifeH / pp.nextLifeH).toFixed(3)
    if (num(pp.nextAugs) && num(actual.augs)) scores.augs = +(actual.augs / pp.nextAugs).toFixed(3)
    if (Object.keys(scores).length) entry.scores = scores
  }
  return entry
}

/**
 * Rolling report over the ledger's scores: per family, the count and the
 * geometric mean of actual/predicted — 1.0 is a calibrated forecaster,
 * persistently above 1 means the drivers (and every ETA built on them) run
 * conservative, below 1 optimistic. Published every pass so drift is a
 * telemetry line, not an archaeology project.
 */
export function ledgerScores(ledger) {
  const fams = {}
  for (const e of Array.isArray(ledger) ? ledger : []) {
    for (const [k, v] of Object.entries(e?.scores ?? {})) {
      if (!(typeof v === 'number' && isFinite(v) && v > 0)) continue
      ;(fams[k] ??= []).push(v)
    }
  }
  const out = {}
  for (const [k, vs] of Object.entries(fams)) {
    out[k] = { n: vs.length, geoMean: +Math.exp(vs.reduce((a, v) => a + Math.log(v), 0) / vs.length).toFixed(3) }
  }
  return out
}

/**
 * The ACHIEVABLE long-run rate, rho — ln(M) per hour that completed lives have
 * actually delivered in this BitNode.
 *
 * This is the comparison term in the renewal-reward stopping rule. A run that
 * installs, resets, and rebuilds is a renewal process: each life spends T hours
 * to produce ln(M) of reward, and the quantity being maximised is not this
 * life's average but the LONG-RUN average across lives. The optimal policy for
 * that is a marginal rule — keep accumulating while the marginal rate of ln(M)
 * exceeds the rate a fresh life would sustain, and cash in the moment it drops
 * below. rho is that rate.
 *
 * WHY IT IS NOT THIS LIFE'S AVERAGE, which is what installgate.js used before.
 * `ln(M)/A` is a fixed-point approximation of rho that reads its own life's
 * wall clock, and therefore inherits every hour that life wasted. Rearranged,
 * the old rule said waiting wins whenever
 *
 *     ln(M_future)/ln(M_now)  >  1 + wait/A
 *
 * so a large A drives the bar toward 1 and ANY improvement justifies waiting.
 * Dead time made the gate more patient, precisely when it should have been less
 * — and it compounds, because the longer a run is stuck the cheaper further
 * waiting looks. Live: nine hours stalled at a 32GB home put A at 12.7h, which
 * dropped the bar to 1.03 and held an install that an honest denominator (1.95h
 * of actual progress, bar 1.21) would have taken immediately.
 *
 * rho does not reference A at all, so no amount of dead time can move it.
 *
 * SAME BITNODE ONLY, and this is not fussiness: BitNode 4 multiplies server
 * money by 0.1125 and hacking experience by 0.4, so its lives run at a rate
 * that has nothing to say about BitNode 1's. An entry with no `bitNode` is from
 * before this field existed and is refused rather than assumed to be local.
 *
 * MEDIAN, not mean or max. The mean is dragged by a single anomalous life (the
 * ledger holds a 3.25h life next to a 0.57h one); the max would claim the best
 * life ever seen is repeatable, which overstates rho and installs too early.
 * The median is the rate half of the recent lives beat, which is the honest
 * reading of "what this configuration sustains".
 *
 * Returns null — never a number — when there is nothing to measure. The first
 * life in a BitNode has no completed lives by definition, and a guessed rho
 * would be indistinguishable from a measured one at exactly the moment the
 * measurement does not exist.
 *
 * @param {Array}  ledger    /tel/lifetimes.txt, oldest first.
 * @param {number} bitNode   the node to measure; entries from others are refused.
 * @param {number} [minN]    samples required before rho is claimed. Default 2:
 *                           one life is an anecdote, and the rule it feeds
 *                           decides when to end every subsequent life.
 * @returns {{rate: number, n: number, samples: number[]} | null}
 */
export function achievableRate(ledger, bitNode, minN = 2) {
  if (!Array.isArray(ledger) || typeof bitNode !== 'number' || !isFinite(bitNode)) return null
  const rates = []
  for (const e of ledger) {
    if (!e || e.bitNode !== bitNode) continue
    const lnM = e.lnM
    const h = e.lifeH
    // Every guard is a REFUSAL, not a default. A life that recorded no reward,
    // or one whose duration rounded to zero, cannot contribute a rate — and a
    // zero-length life would otherwise contribute an infinite one.
    if (!(typeof lnM === 'number' && isFinite(lnM) && lnM > 0)) continue
    if (!(typeof h === 'number' && isFinite(h) && h > 0.01)) continue
    rates.push(lnM / h)
  }
  if (rates.length < minN) return null
  rates.sort((a, b) => a - b)
  const mid = rates.length >> 1
  const rate = rates.length % 2 ? rates[mid] : (rates[mid - 1] + rates[mid]) / 2
  return { rate, n: rates.length, samples: rates.map((r) => +r.toFixed(4)) }
}
