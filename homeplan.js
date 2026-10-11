// homeplan.js — THE NEXT HOME UPGRADE, trajectory against trajectory, on the
// committed Bladeburner route. PURE (0GB): progress.js prices with it, the
// tests replay it.
//
// WHY. Home RAM survives every install (prestigeHomeComputer leaves maxRam,
// ServerHelpers.ts:226-239), so one purchase pays for the rest of the node.
// progress.js priced it only as perGB x homeRam money income against the
// hacking exit (exitplan.spendExit). On the Bladeburner route the exit is
// the 21 black ops (bbplan.bladeExit) and money moves it only through the
// augmentations an install buys, so that pricing came out null — live BN4.3
// (2026-10-03) decisions.spends.home sat UNPRICED for 10.4h at 64GB while
// the 128GB tier would admit the full Bladeburner daemon.
//
// A TIER IS A STEP, NOT A SLOPE. Crossing 128GB admits whole daemons
// (boot.js's manifest, its planner stack.planStack — boot.js publishes the
// next tier's plan as /tel/boot.txt nextTier). Each one admitted is priced by
// what it does to THIS exit (UNLOCK_ON_BLADE below), from the hour the
// purchase is made:
//
//   bladeburner.js   the full daemon instead of bb-lite: where the start carries
//                    bb-lite's lean phase (bbplan s0.lean), the full policy
//                    from the purchase on (a {full: true} step); else the
//                    trajectory's rank scale x 1/LITE_OVER_FULL — only where a
//                    rooted non-home host can hold its raised 92.75GB
//   go.js            the opponent it will choose on THIS exit's channel
//                    weights (goweights.bladeGoWeightsGen through
//                    goplan.chooseOpponent — go.js reads the same weights from
//                    the gate): combat (Tetrads) as a growing level
//                    multiplier, reset at an install; any other channel
//                    (faction_rep, hacking_*) reaches this exit only through
//                    an install's batch and is not stepped here (named)
//   batch.js         money: on this exit only through the batch an install
//                    buys (below) — its income over early.js is UNMEASURED in
//                    a node where it never ran, so only the linear perGB x
//                    homeRam term the other spends use is credited
//   share.js, fast.js, nfg.js, bootnag.js, faction.js, endgame.js, sleeveaug.js
//                    nothing on this exit (named per script)
//
// THE PURCHASE ITSELF: at the earliest hour the money stream (as the caller
// models it) reaches the price — before the committed install, or else in
// the life after it from the post-install balance. Bought before the install,
// the batch that install buys is re-planned on what is left (the caller's
// replan), so the augmentations it displaces move the exit through their
// combat and bladeburner_* multipliers (bladeContentOf) — the existing
// install machinery, not a claim.
//
// Not simulated, named in the result: The Blade's Simulacrum when either arm
// can reach its price before the exit (the verdict then refuses rather than
// guess), the minutes between the purchase and bladeburner.js running (the
// watchdog places it, or reserves a host batch.js drains for it within a
// batch cycle — bbliteplan.fullPlacementOf; the healthcheck fails BLADEBURNER
// FULL NOT PLACED after 15 min), and later installs (each is the next
// decision's, as in bladeInstallCompareOf).

import { bladeExitGen } from 'bbplan.js'
import { LITE_OVER_FULL } from 'bbliteplan.js'
import { OPPONENTS, POWER_PER_HOUR, effectAt, keyOfGame, chooseOpponent } from 'goplan.js'
import { ramUpgradeCost } from 'homecost.js'
import { giftFleetInputsOf } from 'stanekplan.js'
import { bestExitPolicy } from 'exitplan.js'

/** batchAt may return a generator (progress.js re-plans through augplan.planPurchasesGen): run it in this generator's steps. */
function* callOut(x) {
  return x && typeof x.next === 'function' && typeof x[Symbol.iterator] === 'function' ? yield* x : x
}

const fin = (x) => typeof x === 'number' && isFinite(x)

/** What each script the next tier admits does to the black-op exit. */
export const UNLOCK_ON_BLADE = {
  'bladeburner.js': { channel: 'rank', why: 'the full daemon replaces bb-lite: rank x 1/LITE_OVER_FULL' },
  'go.js': { channel: 'go', why: "the Go farm: its opponent's channel on this exit" },
  'batch.js': { channel: 'money', why: 'income: on this exit only through the batch an install buys; its gain over early.js is unmeasured in this node — only the linear perGB x homeRam term is credited' },
  'share.js': { channel: null, why: 'multiplies faction-WORK reputation; the slot is the division\'s on this route' },
  'fast.js': { channel: null, why: 'a dashboard' },
  'upkeep.js': { channel: null, why: "reclaims faction work's focus bonus; the slot is the division's on this route" },
  'progress.js': { channel: null, why: 'already runs (a watchdog job); the tier only budgets its home block' },
  'bootnag.js': { channel: null, why: 'a human-TODO report' },
  'nfg.js': { channel: null, why: 'NeuroFlux by donation: needs the donation favour, and money on this exit moves only an install\'s batch' },
  'faction.js': { channel: null, why: 'advisory' },
  'endgame.js': { channel: null, why: 'a no-op until The Red Pill (the World Daemon exit, not this one)' },
  'sleeveaug.js': { channel: null, why: 'sleeve augmentations: the fleet is priced by sleeve.js on this exit; not credited here' },
}

/**
 * The scripts the next home tier admits that this one does not, from boot.js's
 * plans (/tel/boot.txt: `admit` now, `nextTier` at the next RAM block).
 * { homeRam, unlocked: [{script, where, cost, raisesTo, kind}], retired } or
 * null when either plan is missing or the next one was not made for this home.
 */
export function tierUnlocksOf(boot, homeRam) {
  const nt = boot?.nextTier
  if (!nt || !Array.isArray(nt.admit) || !Array.isArray(boot?.admit) || !fin(homeRam) || nt.fromHomeRam !== homeRam) return null
  const now = new Set(boot.admit.map((e) => e?.script))
  const next = new Set(nt.admit.map((e) => e?.script))
  return {
    homeRam: nt.homeRam,
    unlocked: nt.admit.filter((e) => e?.script && !now.has(e.script)).map((e) => ({ script: e.script, where: e.where ?? null, cost: e.cost ?? null, raisesTo: e.raisesTo ?? null, kind: e.kind ?? null })),
    retired: [...now].filter((s) => !next.has(s)),
  }
}

/**
 * The earliest hour the purchase is affordable: moneyAt(h) (money on hand h
 * hours from now, without it) reaching `cost` before the committed install at
 * installAtH; else in the next life, from `post.money0` at `post.perSec`.
 * {atH, life: 'this' | 'next', why} or {atH: null, why}.
 */
export function homeBuyAtOf({ cost, moneyAt, installAtH = Infinity, post = null, maxH = 400 }) {
  if (!fin(cost) || cost <= 0 || typeof moneyAt !== 'function') return { atH: null, why: 'the price or the money trajectory is unreadable' }
  const edge = Math.min(fin(installAtH) ? Math.max(0, installAtH) : maxH, maxH)
  const m0 = moneyAt(0)
  if (fin(m0) && m0 >= cost) return { atH: 0, life: 'this', why: 'affordable now' }
  const mE = moneyAt(edge)
  if (fin(mE) && mE >= cost) {
    let lo = 0
    let hi = edge
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2
      if (moneyAt(mid) >= cost) hi = mid
      else lo = mid
    }
    return { atH: hi, life: 'this', why: `the stream reaches $${(cost / 1e6).toFixed(2)}m in ${hi.toFixed(2)}h` }
  }
  if (fin(installAtH) && installAtH < maxH && post && fin(post.perSec) && post.perSec > 0) {
    const h = installAtH + Math.max(0, cost - (fin(post.money0) ? post.money0 : 0)) / post.perSec / 3600
    return h < maxH ? { atH: h, life: 'next', why: `not before the install at ${installAtH.toFixed(2)}h; in the next life at ${h.toFixed(2)}h` } : { atH: null, why: 'not affordable inside the horizon' }
  }
  return { atH: null, why: `not affordable before ${edge.toFixed(1)}h on this stream` }
}

/**
 * THE BLADEBURNER ROUTE'S OWN HOME PURCHASE: when the full daemon takes over
 * from bb-lite, as the route's start prices it (bbplan s0.lean.untilH), where
 * no purchase is approved yet (bbliteplan.leanUntilOf -> Infinity).
 *
 * WHY. Under FULL_TIER the full daemon arrives only with the home upgrade,
 * and that upgrade is approved only by the blade route's own home verdict
 * (progress.js bladeHomeVerdictOf), which runs only once the route is
 * 'blade'. Priced as "bb-lite forever", the blade arm of the ROUTE decision
 * assumed the route never buys the tier its exit depends on — and the lean
 * policy alone (no Raid, team 0, one city) does not reach the first black
 * op's 2500 rank inside the horizon. Live BN14.2 2026-10-05 23:11Z (home
 * 64GB, rank 23, combat ~250): every blade draw unpriced (pFeasible 0), the
 * route took 'hack' at a 999h mean, while the same start with the full
 * daemon priced ~56h and the $31.9m 128GB block was ~0.7h of income away.
 * A deadlock: no blade route without the purchase, no purchase verdict
 * without the blade route.
 *
 * So the route's arm carries the purchase the route makes: every RAM block
 * from homeRam up to `tier` (homecost.ramUpgradeCost on the node's
 * multiplier), bought at the earliest hour the money stream (wealth +
 * perSec x h, linear: its growth is not simulated, pessimistic) reaches the
 * sum (homeBuyAtOf), plus the placement (placeH). The route's home verdict
 * then prices that same purchase trajectory against trajectory.
 * NOT SIMULATED, named: an install before the purchase (the money resets;
 * the purchase is then the next life's), cores bought first by homeup.js
 * (nextHomeUpgrade's cheapest-first: cores cost >= $1b, so only where RAM
 * blocks cost more).
 *
 * Returns {untilH, buyAtH, cost, why}; untilH Infinity when the stream never
 * affords it inside maxH (the lean phase then never ends, as before).
 */
export function routeFullAtOf({ homeRam, tier, nodeRamCost, wealth, perSec, placeH, maxH = 400 } = {}) {
  if (!fin(homeRam) || !(homeRam > 0) || !fin(tier)) return { untilH: Infinity, buyAtH: null, cost: null, why: 'home RAM or the full tier unread: bb-lite throughout' }
  if (homeRam >= tier) return { untilH: placeH, buyAtH: 0, cost: 0, why: `home ${homeRam}GB already admits the full daemon: its placement` }
  let cost = 0
  const blocks = []
  for (let r = homeRam; r < tier; r *= 2) {
    cost += ramUpgradeCost(r, nodeRamCost)
    blocks.push(r * 2)
  }
  const m0 = fin(wealth) && wealth > 0 ? wealth : 0
  const rate = fin(perSec) && perSec > 0 ? perSec : 0
  const buy = homeBuyAtOf({ cost, moneyAt: (h) => m0 + rate * 3600 * h, maxH })
  if (!fin(buy.atH)) return { untilH: Infinity, buyAtH: null, cost, why: `the route's ${tier}GB home ($${(cost / 1e6).toFixed(2)}m) is not affordable on $${(m0 / 1e6).toFixed(2)}m + $${((rate * 3600) / 1e6).toFixed(2)}m/h inside ${maxH}h: bb-lite throughout` }
  return { untilH: buy.atH + placeH, buyAtH: buy.atH, cost, why: `the route buys home ${homeRam}GB -> ${blocks.join(' -> ')}GB ($${(cost / 1e6).toFixed(2)}m) at ${buy.atH.toFixed(2)}h on $${(m0 / 1e6).toFixed(2)}m + $${((rate * 3600) / 1e6).toFixed(2)}m/h; the full daemon from ${(buy.atH + placeH).toFixed(2)}h` }
}

/**
 * The Go farm's combat channel as level-multiplier steps on the black-op
 * exit: effect(n) (goplan.effectAt, Go/effects/effect.ts) on nodes growing at
 * POWER_PER_HOUR from fromH, zeroed at an install (Go.prestigeAugmentation),
 * hourly. [] for any other channel. The steps are ratios (each the change
 * since the last), so they compose in bladeExit's multipliers.
 */
export function goCombatSteps({ opponent, fromH, toH, installAtH = Infinity, goPower = 1 }) {
  const key = keyOfGame(opponent)
  const o = key ? OPPONENTS[key] : null
  if (!o || o.channel !== 'combat' || !fin(fromH) || !fin(toH) || !(POWER_PER_HOUR[key] > 0)) return []
  const out = []
  let prev = 1
  let start = fromH
  for (let h = Math.ceil(fromH); h <= toH; h++) {
    if (fin(installAtH) && h >= installAtH && start < installAtH) start = installAtH
    const n = Math.max(0, h - start) * POWER_PER_HOUR[key]
    const e = effectAt(n, o.power, goPower) ?? 1
    const r = e / prev
    if (Math.abs(r - 1) > 1e-9) out.push({ atH: h, gains: { strength: r, defense: r, dexterity: r, agility: r } })
    prev = e
  }
  return out
}

/**
 * THE VERDICT'S TWO TRAJECTORIES on the black-op exit, from one start.
 *
 *   startFor(spec)  the route's builder (progress.js pc.bladeCtx.startFor)
 *   spec            the committed install spec ({kind:'wait', waitH, blade} or null: none)
 *   cost            the upgrade's price; buy: homeBuyAtOf's result
 *   unlocks         tierUnlocksOf's result
 *   daemonNow       'bb-lite' | 'bladeburner.js' (who runs the division now)
 *   fullHost        {ok, why}: a rooted non-home host can hold bladeburner.js's raised RAM
 *   liteOverFull    bbliteplan.LITE_OVER_FULL.mid unless the caller says
 *   go              {opponent, goPower, weights, windowH, nodePower}: the blade-route
 *                   Go weights (bladeGoWeightsGen) the opponent is chosen on
 *                   (goOpponentOnBlade); opponent = /tel/go.txt's, the fallback
 *   batchAt(m)      the install's batch content ({gains, simulacrum}) bought with $m (re-planned)
 *   moneyAtInstall  money at the committed install without the purchase
 *   gainPerSec      the linear income term the RAM adds (perGB x homeRam), money only
 *   maxH            the horizon
 *
 * Returns {deltaH, withH, withoutH, buyAtH, effects: [{name, deltaH, why}],
 * credited: [...], notCredited: [...], displaced} or {deltaH: null, why}.
 * The breakdown runs each effect ALONE against the without-arm; the verdict
 * is the arm with all of them.
 */
export function* bladeHomeExitGen(o) {
  const { startFor, spec = null, cost, buy, unlocks, daemonNow = 'bb-lite', fullHost = { ok: false, why: 'unread' }, liteOverFull = LITE_OVER_FULL.mid, go = null, batchAt = null, moneyAtInstall = null, gainPerSec = 0, maxH = 400 } = o ?? {}
  if (typeof startFor !== 'function') return { deltaH: null, why: 'no Bladeburner start to price from' }
  if (!unlocks) return { deltaH: null, why: "the next tier's admissions are unread (/tel/boot.txt nextTier missing or for another home size — boot.js publishes it every run)" }
  if (!fin(buy?.atH)) return { deltaH: null, why: `the purchase never happens on this stream: ${buy?.why ?? 'unread'}` }
  const buyAtH = buy.atH
  const installAtH = spec?.kind === 'wait' && fin(spec.waitH) ? spec.waitH : Infinity
  const credited = []
  const notCredited = []
  const effects = []
  // 1. The full daemon.
  let rankStep = null
  const fullAdmitted = unlocks.unlocked.some((u) => u.script === 'bladeburner.js')
  if (daemonNow === 'bladeburner.js') notCredited.push({ script: 'bladeburner.js', why: 'already the daemon' })
  else if (!fullAdmitted) notCredited.push({ script: 'bladeburner.js', why: `not admitted at ${unlocks.homeRam}GB` })
  else if (!fullHost?.ok) notCredited.push({ script: 'bladeburner.js', why: `admitted, but no host can hold it: ${fullHost?.why ?? 'unread'}` })
  else if (!(liteOverFull > 0 && liteOverFull <= 1)) notCredited.push({ script: 'bladeburner.js', why: 'the lean/full rank ratio is unreadable' })
  else if (startFor(spec)?.lean) {
    // THE LEAN DAEMON IS IN THE START (bbplan s0.lean, bbliteplan.leanUntilOf:
    // under the tier it acts until this purchase): the full daemon's policy
    // from the purchase on, simulated — not a rank ratio on top of a
    // trajectory that already priced the full daemon.
    rankStep = { atH: buyAtH, full: true }
    credited.push({ script: 'bladeburner.js', why: `the full daemon's policy from ${buyAtH.toFixed(2)}h, bb-lite's before (${fullHost.why})` })
  } else {
    rankStep = { atH: buyAtH, rankScaleMult: 1 / liteOverFull }
    credited.push({ script: 'bladeburner.js', why: `rank x${(1 / liteOverFull).toFixed(3)} from ${buyAtH.toFixed(2)}h (${fullHost.why})` })
  }
  // 2. The Go farm: the opponent go.js WILL choose once the tier admits it —
  // goplan.chooseOpponent on this exit's own channel weights
  // (goweights.bladeGoWeightsGen), the same pricing go.js reads from the gate
  // — else the one /tel/go.txt says it farms now.
  let goSteps = []
  let goPick = null
  if (unlocks.unlocked.some((u) => u.script === 'go.js')) {
    const pick = goOpponentOnBlade(go)
    goPick = pick
    const key = pick.opponent
    const ch = key ? OPPONENTS[key]?.channel : null
    if (ch === 'combat') {
      goSteps = goCombatSteps({ opponent: key, fromH: buyAtH, toH: maxH, installAtH, goPower: fin(go?.goPower) ? go.goPower : 1 })
      credited.push({ script: 'go.js', why: `${key} (${pick.source}): combat levels x effect(nodes) from ${buyAtH.toFixed(2)}h` })
    } else notCredited.push({ script: 'go.js', why: key ? `go.js farms ${key} (${ch}, ${pick.source}) — its channel reaches this exit only through the install's batch, not simulated as a step` : `no opponent: ${pick.why}` })
  }
  // 3. The rest, named.
  for (const u of unlocks.unlocked) {
    if (u.script === 'bladeburner.js' || u.script === 'go.js') continue
    const e = UNLOCK_ON_BLADE[u.script]
    if (u.script === 'batch.js') continue // the money channel below
    notCredited.push({ script: u.script, why: e?.why ?? 'not priced on this exit (no entry in UNLOCK_ON_BLADE)' })
  }
  // 4. Money: the batch the committed install buys, re-planned on what the purchase leaves.
  let baseSpec = spec
  let withSpec = spec
  let displaced = null
  if (fin(installAtH) && buyAtH < installAtH) {
    if (typeof batchAt !== 'function' || !fin(moneyAtInstall)) return { deltaH: null, why: 'bought before the committed install, but the batch re-plan is unavailable' }
    const after = moneyAtInstall - cost + (fin(gainPerSec) && gainPerSec > 0 ? gainPerSec * (installAtH - buyAtH) * 3600 : 0)
    const b0 = yield* callOut(batchAt(moneyAtInstall))
    yield // each re-plan its own steps (planPurchasesGen through progress.js; goweights.bladeGoWeightsGen)
    const b1 = yield* callOut(batchAt(Math.max(0, after)))
    yield
    if (!b0 || !b1) return { deltaH: null, why: 'the install batch could not be re-planned' }
    displaced = { moneyWithout: Math.round(moneyAtInstall), moneyWith: Math.round(after), without: b0, with: b1 }
    // Both arms re-planned by the one planner: they differ by the purchase alone.
    baseSpec = { ...spec, blade: { gains: b0.gains, simulacrum: b0.simulacrum === true } }
    withSpec = { ...spec, blade: { gains: b1.gains, simulacrum: b1.simulacrum === true } }
  } else if (fin(installAtH)) displaced = { none: `bought at ${buyAtH.toFixed(2)}h, after the committed install at ${installAtH.toFixed(2)}h: its batch is untouched` }
  else displaced = { none: 'no install is committed on this route: nothing is displaced' }
  const exitOf = function* (sp, steps) {
    // Both arms from a start whose lean phase never ends: the route's own start
    // carries an approved purchase's handover (bbliteplan.leanUntilOf), which
    // here is the decision itself.
    const s1 = startFor(sp)
    const s0 = s1?.lean ? { ...s1, lean: { ...s1.lean, untilH: Infinity } } : s1
    yield
    const r = yield* bladeExitGen(steps.length ? { ...s0, steps } : s0)
    return fin(r?.hours) ? r.hours : null
  }
  // THE WITHOUT-ARM PAST THE HORIZON (censored): bb-lite forever may not
  // reach the black ops inside the start's horizon at all (live BN14.2
  // 23:11Z: rank 1634 of Typhoon's 2500 in 400h). Its exit is then AT LEAST
  // the horizon, so withH - horizon bounds the gain from the conservative
  // side — unpriced, the verdict never bought the tier the route's own exit
  // is priced on (routeFullAtOf).
  const withoutRaw = yield* exitOf(baseSpec, [])
  const horizonH = fin(startFor(baseSpec)?.maxH) ? startFor(baseSpec).maxH : 400
  const allSteps = [...(rankStep ? [rankStep] : []), ...goSteps]
  const withH = yield* exitOf(withSpec, allSteps)
  if (!fin(withoutRaw) && !fin(withH)) return { deltaH: null, why: `the black-op exit is unpriced with and without the purchase (neither finishes inside ${horizonH}h)` }
  if (!fin(withH)) return { deltaH: null, why: 'the black-op exit with the purchase is unpriced' }
  const censored = fin(withoutRaw) ? null : { horizonH, why: `without the purchase the exit does not finish inside the ${horizonH}h horizon: priced at the horizon, a lower bound (the gain is at least ${(horizonH - withH).toFixed(1)}h)` }
  const withoutH = fin(withoutRaw) ? withoutRaw : horizonH
  // The breakdown: each effect alone.
  const alone = [
    ['full daemon (bladeburner.js)', rankStep ? [baseSpec, [rankStep]] : null],
    ['Go farm (go.js)', goSteps.length ? [baseSpec, goSteps] : null],
    ['displaced augmentations', withSpec !== baseSpec ? [withSpec, []] : null],
  ]
  for (const [name, a] of alone) {
    if (!a) continue
    const h = yield* exitOf(a[0], a[1])
    effects.push({ name, deltaH: fin(h) ? +(h - withoutH).toFixed(3) : null })
  }
  // The conservative end of the lean/full ratio, published beside the verdict.
  let conservative = null
  if (rankStep?.rankScaleMult && LITE_OVER_FULL.hi > liteOverFull) {
    const h = yield* exitOf(withSpec, [{ ...rankStep, rankScaleMult: 1 / LITE_OVER_FULL.hi }, ...goSteps])
    conservative = fin(h) ? { liteOverFull: LITE_OVER_FULL.hi, withH: +h.toFixed(3), deltaH: +(h - withoutH).toFixed(3) } : null
  }
  return { deltaH: withH - withoutH, withH, withoutH, buyAtH, buyLife: buy.life, effects, credited, notCredited, displaced, conservative, goPick, ...(censored ? { censored } : {}) }
}

/**
 * The opponent go.js plays on this route: chooseOpponent on the black-op
 * exit's channel weights (go.weights, goweights.bladeGoWeightsGen) at the
 * farm's current node power (go.nodePower; absent: 0 — a farm the tier is
 * about to start), the point win rates (a price, not a Thompson draw). When
 * the weights refuse or are absent: go.opponent (/tel/go.txt). Returns
 * {opponent, source, why}.
 */
export function goOpponentOnBlade(go) {
  const fallback = (why) => {
    const key = keyOfGame(go?.opponent)
    return { opponent: key, source: key ? '/tel/go.txt' : null, why: key ? `${why}; go.js's current opponent` : `${why}; no opponent read from /tel/go.txt` }
  }
  if (!go?.weights) return fallback('no Bladeburner-route Go weights')
  const nodePower = go.nodePower && typeof go.nodePower === 'object' ? go.nodePower : Object.fromEntries(Object.keys(OPPONENTS).map((k) => [k, 0]))
  const r = chooseOpponent({ weights: go.weights, windowH: go.windowH, incumbent: keyOfGame(go.opponent) ?? undefined, nodePower, goPower: fin(go.goPower) ? go.goPower : 1 })
  if (r.refused || !r.opponent) return fallback(`the blade weights refused: ${r.why}`)
  return { opponent: r.opponent, source: 'priced on the black-op exit', why: r.why }
}

// ---------------------------------------------------------------------------
// THE NEXT HOME BLOCK ON THE HACKING ROUTE: what it UNLOCKS, not $/s alone.
//
// exitplan.spendExit priced home as perGB x homeRam of batcher income (and
// exp): every new GB a batcher GB. At a small home that is the wrong
// trajectory — home is where the residents wait for room. Live BN13.1
// 2026-10-11 at 128GB: progress.js's block, sleeve.js (49.75GB, not running:
// five idle sleeves), the gift's charger and the batcher all competed for
// it, and the verdict read deltaH -0.07h on 3031 $/s, buy false. The
// with-arm here is the exit WITH the block as it would be used:
//
//   the residents waiting for room (watchdog.txt daemons absent and
//   blocked/reserving), admitted in order while the block holds them, each
//   priced on its channel (UNLOCK_ON_HACK) — sleeve.js: the fleet's
//   transfer from the node's last sleeve.txt (sleeves and their stats
//   persist through installs: `byObjective`), the better of the exp and rep
//   objectives on the exit (the sleeve plan chooses by the exit too);
//   the gift's charger on the grown fleet (stanekplan.giftFleetInputsOf:
//   f x the fleet's RAM charges, so each life's gift averages higher);
//   the batcher on what is left, less the charger's share f.
//
// What the exit cannot see is named in `notSimulated`, never folded in.
// ---------------------------------------------------------------------------

/** What each resident that waits for home room does to the HACKING exit. */
export const UNLOCK_ON_HACK = {
  'sleeve.js': { channel: 'fleet', why: "the sleeve fleet: its exp transfer / faction reputation join the climb (exitInputsOf's planFleet terms)" },
  'go.js': { channel: null, why: 'the Go farm: priced by its own placement verdict (goplace.goPlaceValueOf), not here' },
  'bladeburner.js': { channel: null, why: 'acts only on the Bladeburner route' },
  'bb-lite.js': { channel: null, why: 'acts only on the Bladeburner route' },
  'stock.js': { channel: null, why: "the trader: its return is in the inputs' capital stream already" },
  'gang.js': { channel: null, why: 'the gang: priced by gangWorth' },
  'hashspend.js': { channel: null, why: 'hash spending: priced by hashplan' },
}

/**
 * The residents waiting for home room, from the watchdog record (daemons
 * admitted and absent — `absentSince` — whose placement is blocked or
 * reserving a block) with their RAM from boot.txt's plan (raisesTo, else
 * cost). [{script, gb, why}] in the watchdog's order; [] when none or
 * unreadable (the verdict then credits no unlock — a floor).
 */
export function waitingResidentsOf(watchdog, boot) {
  const d = watchdog?.daemons
  if (!d || typeof d !== 'object') return []
  const gbOf = new Map()
  for (const e of [...(Array.isArray(boot?.admit) ? boot.admit : []), ...(Array.isArray(boot?.nextTier?.admit) ? boot.nextTier.admit : [])]) {
    const gb = fin(e?.raisesTo) && e.raisesTo > 0 ? e.raisesTo : fin(e?.cost) && e.cost > 0 ? e.cost : null
    if (e?.script && gb !== null && !gbOf.has(e.script)) gbOf.set(e.script, gb)
  }
  const out = []
  for (const [script, rec] of Object.entries(d)) {
    const a = rec?.placement?.action
    if (!rec?.absentSince || !(a === 'blocked' || a === 'reserve')) continue
    const gb = gbOf.get(script)
    if (!fin(gb)) continue
    out.push({ script, gb, why: String(rec.placement?.why ?? '').slice(0, 160) })
  }
  return out
}

/** The fleet's figures for the unlock, from /tel/sleeve.txt of THIS node (any age: sleeves persist through installs). */
export function fleetForUnlockOf(sleeveRec, node) {
  if (!sleeveRec || sleeveRec.bitNode !== node || sleeveRec.disableSleeveExp === true) return null
  const b = sleeveRec.byObjective
  const exp = fin(b?.exp) && b.exp > 0 ? b.exp : null
  const rep = fin(b?.rep) && b.rep > 0 ? b.rep : null
  if (exp === null && rep === null) return null
  return { exp, rep, at: sleeveRec.at ?? null }
}

/** `inputs` with a fleet transfer added (exitInputsOf's additive planFleet terms: sleeveplan expPerSecWithFleet / repPerSecWithFleet). */
function withFleet(inputs, { exp = 0, rep = 0 }) {
  const out = { ...inputs }
  if (exp > 0 && fin(inputs.expPerSec) && inputs.expPerSec > 0) {
    out.expPerSec = inputs.expPerSec + exp
    if (inputs.expScalesWithLevel) out.expFlatPerSec = (fin(inputs.expFlatPerSec) ? inputs.expFlatPerSec : 0) + exp
  }
  if (rep > 0 && fin(inputs.repPerSec) && inputs.repPerSec > 0) out.repPerSec = inputs.repPerSec + rep
  return out
}

/**
 * THE WITH-ARM'S INPUTS for the next home block on the hacking route.
 *   inputs    the shared exit inputs (the without-arm's)
 *   addGB     the block's RAM (0 for a cores upgrade); addCores (1 for cores)
 *   waiting   waitingResidentsOf(...)
 *   fleet     fleetForUnlockOf(...) (null: the fleet is unmeasured here)
 *   choose    (inputs) => exit hours (default bestExitPolicy), for the fleet's objective
 * Returns {inputs, unlocked, batcherGB, moneyGB, gift, credited, notSimulated, why}:
 * moneyGB is the GB the caller prices at the batcher's per-GB income and exp.
 */
export function hackHomeArmOf({ inputs, addGB = 0, addCores = 0, waiting = [], fleet = null, choose = null } = {}) {
  const credited = []
  const notSimulated = []
  const gb = fin(addGB) && addGB > 0 ? addGB : 0
  let left = gb
  const unlocked = []
  for (const w of Array.isArray(waiting) ? waiting : []) {
    if (!fin(w?.gb) || w.gb <= 0 || w.gb > left) continue
    left -= w.gb
    unlocked.push(w)
  }
  let arm = inputs
  for (const u of unlocked) {
    const ch = UNLOCK_ON_HACK[u.script]
    if (ch?.channel === 'fleet') {
      if (!fleet) {
        notSimulated.push(`${u.script} (${u.gb}GB) runs with the block, but the fleet has no measurement in this node (no /tel/sleeve.txt of it): its transfer is not priced`)
        continue
      }
      const hoursOf = typeof choose === 'function' ? choose : (x) => bestExitPolicy(x)?.best?.hours ?? null
      const opts = [fleet.exp ? { key: 'exp', x: withFleet(arm, { exp: fleet.exp }) } : null, fleet.rep ? { key: 'rep', x: withFleet(arm, { rep: fleet.rep }) } : null].filter(Boolean)
      let best = null
      for (const o of opts) {
        const h = hoursOf(o.x)
        if (fin(h) && (best === null || h < best.h)) best = { ...o, h }
      }
      if (!best) {
        notSimulated.push(`${u.script}: the exit with the fleet is unpriced`)
        continue
      }
      arm = best.x
      credited.push(`${u.script} (${u.gb}GB): the fleet on ${best.key} (${best.key === 'exp' ? `${fleet.exp.toFixed(2)} exp/s` : `${fleet.rep.toFixed(3)} rep/s base`}, sleeve.txt ${fleet.at ?? '?'})`)
    } else notSimulated.push(`${u.script} (${u.gb}GB): ${ch?.why ?? 'no channel on the hacking exit is modelled'}`)
  }
  // The gift's charger on the grown fleet: the block's RAM the residents do
  // not take (theirs is theirs), and a core on home.
  const g = giftFleetInputsOf(arm, { addGB: left, addCores, host: 'home' })
  const f = g.dLn && fin(g.f) && g.f > 0 && g.f < 1 ? g.f : 0
  if (g.dLn && (left > 0 || addCores > 0)) {
    arm = g.inputs
    credited.push(g.why)
  } else if (!g.dLn) notSimulated.push(g.why)
  const moneyGB = left * (1 - f)
  return {
    inputs: arm,
    unlocked: unlocked.map((u) => u.script),
    batcherGB: left,
    moneyGB,
    gift: g.dLn,
    credited,
    notSimulated,
    why: `+${gb}GB${addCores ? ` +${addCores} core` : ''}: ${unlocked.length ? `admits ${unlocked.map((u) => `${u.script} ${u.gb}GB`).join(', ')}; ` : ''}batcher ${moneyGB.toFixed(1)}GB${f ? ` (charger f=${f} of ${left}GB)` : ''}`,
  }
}
