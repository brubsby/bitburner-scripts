// goplace.js — IS go.js WORTH ITS RAM HERE, NOW? The priced placement verdict
// seed.js (8GB..128GB) and watchdog.js (64GB up) act on. PURE: no ns surface.
//
// Until 2026-10-07 this was raiseplace.goFirstOf: effective Go power =
// GoPower x (SF14 ? 2 : 1), "Go-first" at >= 4 — a FIXED threshold that said
// yes in BitNode 14 and no everywhere else, whatever the farm would earn and
// whatever its RAM displaced. Live BN9.2 (entered 2026-10-07 13:13Z, chosen
// FOR the Go farm on a hacking exit): seed.txt "effective Go power 2 (GoPower
// 1 x2 for SF14) < 4: go.js at its 128GB home tier", with $115k/s of hacknet
// production (Netburners multiplies it, HacknetHelpers.tsx:414) and a 32GB home
// whose only displaced resident was four early.js threads earning ~$0.3/s.
//
// THE TWO TRAJECTORIES (CLAUDE.md "Decisions compare simulated trajectories"),
// to ONE endpoint, from ONE set of inputs (goPlaceStreamsOf), through ONE
// simulator (hoursTo) — the runs differ only in the choice:
//
//   with     go.js placed NOW where the placement rule puts it
//            (raiseplace.raisedPlacementOf: home with act.js's slot kept, else
//            the tightest fleet host, its workers evicted; or a bought server,
//            whose price is paid up front). Its farm plays one money arm the
//            whole horizon, at the arm's measured rate (the Thompson posterior
//            means, goplan.armPosterior — the live farm, cheats as played), from
//            the node power already banked this life; the displaced workers'
//            share of the hacking stream is gone for the horizon.
//   without  go.js waits for its home tier (boot.js admits it at GO_BOOT_TIER
//            = 128GB; [GP2] holds it to the manifest): the streams as measured.
//
//   endpoint THE MONEY FOR THE HOME TIER WHERE THE CHOICE ENDS: the sum of
//            the home RAM upgrades from here to GO_BOOT_TIER (homecost, the
//            game's price, x HomeComputerRamCost), or the next one at/above
//            it. That is the bootstrap's own objective below the stack's tier
//            (nodeecon.bootstrapHomeStep: before a planner exists the next RAM
//            tier is a REQUIRED purchase) and the moment the "without"
//            trajectory starts its farm too. Hours to it, with vs without.
//   decision place iff withH < withoutH - GO_PLACE_TOL_H (a minute, as
//            nodeecon.traderPlacement). The margin is published (gainH).
//
// THE STREAMS (each once; nodeecon's split):
//   hacking   getTotalScriptIncome less the trader's own realised share
//             (nodeecon.hackScriptIncome — stock.js books its sales there).
//             hacking_speed scales it x e(t)/e0 (every H/G/W time is
//             1/speed, Hacking.ts:75, and a RAM-bound worker cycles that much
//             faster); hacking_money x (1 + hackShare (e/e0 - 1)) (only the
//             hack side gets richer: goweights' elasticity, at the ASSUMED
//             EARLY.hackSide share with no batcher measurement).
//   hacknet   hacknet.js's moneyPerSec (hashes at the sell floor), x e/e0 on
//             Netburners (hacknet_node_money).
//   e(t)      CalculateEffect (Go/effects/effect.ts:16-22, goplan.effectAt) at
//             the banked power + rate x t, over e at the banked power: the
//             measured streams already carry the bonus banked so far.
//
// BITNODE 14 IS A CASE OF THE RULE, NOT A BRANCH. At GoPower 4 x2 the farm's
// e(t) climbs eight times as steeply, so the same comparison places go.js on
// the 32GB opening (live BN14.1/BN14.2, [GP3]) — and where the displaced
// workers ARE the income and nothing else earns, it does not.
//
// NOT SIMULATED (named in every verdict, never folded in):
//   - the farm's power past the endpoint: the "with" run arrives holding a
//     head start the "without" run never makes up (Go power is a stock until
//     the install, Go/Go.ts:34-47) — a floor on the go side;
//   - the channels with no money term before the planner: faction_rep
//     (Daedalus), combat (Tetrads), crime_success (Slum Snakes), the hidden
//     opponent's hacking level. go.js picks one of those only when its own
//     weights rank it above the money arms (goplan.chooseOpponent), so the
//     best money arm is a floor on what the placed farm is worth;
//   - the displaced workers' hacking EXP (the level that grows the stream);
//   - daemons the placement relocates (moved, assumed to find room) or
//     outranks (autobuy.js/torbuy.js: the TOR/program purchases they wait on);
//   - the placement changing with the tier along the way (held as now);
//   - exit hours: progress.js's goWeights (exit hours per ln, goweights.js)
//     price the farm on the exit once a planner runs, which below the stack's
//     tier it does not (boot defers progress.js; live BN9.2 64GB). From the
//     tier on boot.js admits go.js on home and this verdict decides only
//     whether it may also take a fleet host.

import { effectAt, OPPONENTS, POWER_PER_HOUR, EARLY, armPosterior, parsePosterior, keyOfGame, nodePowerFromBonus, MEASURED_BOARD } from 'goplan.js'
import { stockRecordOf, hacknetRecordOf, hackScriptIncome } from 'nodeecon.js'
import { ramUpgradeCost } from 'homecost.js'

const num = (x) => typeof x === 'number' && isFinite(x)

/** boot.js's tier for go.js (its STACK entry): where "without" starts the farm. [GP2] holds it equal. */
export const GO_BOOT_TIER = 128
/** A place must beat waiting by this much (hours): nodeecon.traderPlacement's minute. */
export const GO_PLACE_TOL_H = 1 / 60
/** Beyond this neither run is said to reach the endpoint ("never"). */
export const GO_PLACE_MAX_H = 2000
/** The money arms, one per channel the endpoint can see (OPPONENTS[].channel). */
export const GO_MONEY_ARMS = ['Illuminati', 'TheBlackHand', 'Netburners']
/** status.txt younger than this is this pass's income (tel.js writes every few seconds). */
export const STATUS_FRESH_MS = 5 * 60e3

/** Effective Go scale: GoPower x (SF14 >= 1 ? 2 : 1) (effect.ts:18-21). null when the node's GoPower is unknown. */
export function goScaleOf({ goPower, sf14 = 0 } = {}) {
  if (!num(goPower) || goPower <= 0) return { effective: null, why: 'GoPower unknown (no BitNode table entry)' }
  const two = num(sf14) && sf14 >= 1
  return { effective: goPower * (two ? 2 : 1), why: `effective Go power ${goPower * (two ? 2 : 1)} (GoPower ${goPower}${two ? ' x2 for SF14' : ''})` }
}

/**
 * The endpoint: dollars of home RAM from `homeMax` to `tier` (or the next
 * upgrade when already there), at the game's price.
 * { target, toRam, steps, why }
 */
export function goMilestoneOf({ homeMax, ramCostMult = 1, tier = GO_BOOT_TIER } = {}) {
  if (!num(homeMax) || homeMax <= 0) return { target: null, toRam: null, steps: 0, why: 'home size unreadable' }
  const to = homeMax < tier ? tier : homeMax * 2
  let target = 0
  let steps = 0
  for (let r = homeMax; r < to; r *= 2) {
    target += ramUpgradeCost(r, ramCostMult)
    steps++
  }
  return { target, toRam: to, steps, why: `home ${homeMax}GB -> ${to}GB: $${(target / 1e6).toFixed(1)}m of RAM${homeMax < tier ? ` (the ${tier}GB tier boot.js admits go.js at)` : ''}` }
}

/**
 * THE SHARED INPUTS, from telemetry records (all ns.read: 0GB). Every reading
 * says where it came from; a missing one is null, never 0.
 *   status     /tel/status.txt (tel.js: incomePerSec = getTotalScriptIncome()[1], wealth = cash + book)
 *   hacknet    /tel/hacknet.txt          stock  /tel/stock.txt (null: no trader record)
 *   goTel      /tel/go.txt (this life's: the banked node power)
 *   posterior  /tel/go-posterior.txt TEXT (the measured arm rates)
 * { ok, hackIncome, hacknetIncome, wealth, nodePower, rates, src, why }
 */
export function goPlaceStreamsOf({ status = null, hacknet = null, stock = null, goTel = null, posterior = null, lastAugReset = null, goPower = 1, sf14 = 0, now = Date.now() } = {}) {
  const src = {}
  const missing = []
  const age = status ? now - Date.parse(status.at ?? '') : NaN
  const fresh = num(age) && age >= 0 && age < STATUS_FRESH_MS
  if (!fresh) missing.push(status ? `status.txt ${num(age) ? Math.round(age / 60e3) + ' min old' : 'undated'}` : 'no status.txt')
  // The hacking stream: script income less the trader's own share of it.
  let hackIncome = null
  if (fresh && num(status.incomePerSec)) {
    const sr = stock ? stockRecordOf(stock, lastAugReset, now) : null
    const split = hackScriptIncome([status.incomePerSec, status.incomePerSec], sr?.ok ? sr : null)
    hackIncome = split.perSec
    src.hacking = `$${hackIncome.toFixed(2)}/s (script income $${status.incomePerSec}/s less ${split.stockSource}${split.stockPerSec ? ` $${split.stockPerSec.toFixed(0)}/s` : ''})`
  } else if (fresh) missing.push('status.txt carries no incomePerSec')
  const hn = hacknetRecordOf(hacknet, lastAugReset, now)
  const hacknetIncome = hn.ok ? hn.perSec : null
  if (!hn.ok) missing.push(hn.why)
  else src.hacknet = `$${hacknetIncome.toFixed(0)}/s (hacknet.txt)`
  const wealth = fresh && num(status.wealth) ? status.wealth : null
  if (fresh && wealth === null) missing.push('status.txt carries no wealth')
  // Node power banked this life (go.txt bonuses, inverted exactly); none recorded this life: 0, said.
  const nodePower = {}
  const goThis = goTel && goTel.lastAugReset === lastAugReset && goTel.bonuses && typeof goTel.bonuses === 'object'
  for (const name of GO_MONEY_ARMS) {
    const pct = goThis ? goTel.bonuses[OPPONENTS[name].game] ?? Object.entries(goTel.bonuses).find(([k]) => keyOfGame(k) === name)?.[1] : undefined
    const n = num(pct) ? nodePowerFromBonus(pct, OPPONENTS[name].power, goPower, sf14) : 0
    nodePower[name] = num(n) ? n : 0
  }
  src.nodePower = goThis ? 'go.txt bonuses this life' : 'no go.js record this life: nothing banked (0)'
  // The farm's rates: the posterior means at the measured board, else the release table.
  const { state, why: pWhy } = parsePosterior(typeof posterior === 'string' ? posterior : posterior ? JSON.stringify(posterior) : '')
  const rates = {}
  const rateSrc = []
  for (const name of GO_MONEY_ARMS) {
    const p = armPosterior(state, name, MEASURED_BOARD, { now })
    const pph = num(p?.powerPerHour) && p.powerPerHour > 0 ? p.powerPerHour : POWER_PER_HOUR[name]
    rates[name] = pph
    rateSrc.push(`${name} ${Math.round(pph)}/h${p && p.n > 0 ? ` (${Math.round(p.n)} games)` : ' (prior)'}`)
  }
  src.rates = `${rateSrc.join(', ')}${pWhy ? ` [${pWhy}]` : ''}`
  const ok = hackIncome !== null && hacknetIncome !== null && wealth !== null
  return { ok, hackIncome, hacknetIncome, wealth, nodePower, rates, src, why: ok ? null : `unmeasured: ${missing.join('; ')}` }
}

/**
 * Hours from `start` dollars to `target` at income(t) $/s (t in hours):
 * midpoint steps of 10 s, growing 1% a step; Infinity past maxH. The ONE
 * simulator both runs use.
 */
export function hoursTo({ start, target, incomeAt, maxH = GO_PLACE_MAX_H }) {
  if (!(start < target)) return 0
  let t = 0
  let m = start
  while (t < maxH) {
    const dt = Math.max(10 / 3600, t * 0.01)
    const perH = incomeAt(t + dt / 2) * 3600
    if (perH > 0 && m + perH * dt >= target) return t + (target - m) / perH
    m += perH * dt
    t += dt
  }
  return Infinity
}

/**
 * One trajectory's income function. `farm` null: the streams as measured
 * (the "without" run). Otherwise {name, pph, n0}: that arm played from now.
 * `d`: the hacking stream's displaced share.
 */
export function incomeAtOf({ hackIncome, hacknetIncome, farm = null, d = 0, goPower = 1, sf14 = 0, hackShare = EARLY.hackSide }) {
  const h = hackIncome * (1 - d)
  if (!farm) return () => h + hacknetIncome
  const meta = OPPONENTS[farm.name]
  const e0 = effectAt(farm.n0, meta.power, goPower, sf14)
  const r = (t) => effectAt(farm.n0 + farm.pph * t, meta.power, goPower, sf14) / e0
  if (meta.channel === 'hacking_speed') return (t) => h * r(t) + hacknetIncome
  if (meta.channel === 'hacking_money') return (t) => h * (1 + hackShare * (r(t) - 1)) + hacknetIncome
  if (meta.channel === 'hacknet_node_money') return (t) => h + hacknetIncome * r(t)
  throw new Error(`goplace: ${farm.name} feeds ${meta.channel}, which has no money term`)
}

/**
 * THE VERDICT. Inputs: the streams (goPlaceStreamsOf), the node's Go scale,
 * the endpoint (goMilestoneOf), and the placement's cost:
 *   displacedGb  hacking-worker GB the placement takes (raisedPlacementOf's workersGb; 0 on free RAM)
 *   workerGb     the hacking workers' GB across the fleet (the stream's RAM)
 *   upfront      dollars paid first (a bought server: cloudCostOf), 0 otherwise
 *   executable   false when no host can ever hold it (the "with" run does not exist)
 * Returns {goFirst, priced, effective, withH, withoutH, gainH, arm, arms, d, why, notSimulated}.
 * goFirst is the decision (the name the placers and the health check read).
 */
export const NOT_SIMULATED = [
  "the farm's power past the endpoint (a head start the waiting run never makes up): a floor on the go side",
  'faction_rep / combat / crime_success / the hidden opponent (no money term before a planner): go.js plays one only when its own weights rank it above the money arms',
  "the displaced workers' hacking exp",
  'daemons relocated (assumed to find room) or outranked (autobuy.js/torbuy.js purchases)',
  'the placement changing with the home tier along the way',
]

export function goPlaceValueOf({ streams, goPower, sf14 = 0, target, displacedGb = 0, workerGb = 0, upfront = 0, executable = true, hackShare = EARLY.hackSide, maxH = GO_PLACE_MAX_H } = {}) {
  const sc = goScaleOf({ goPower, sf14 })
  const no = (why, extra = {}) => ({ goFirst: false, priced: false, effective: sc.effective, withH: null, withoutH: null, gainH: null, arm: null, why: `${why} — go.js at its ${GO_BOOT_TIER}GB home tier`, ...extra })
  if (sc.effective === null) return { ...no(sc.why), effective: null }
  if (!streams?.ok) return no(`UNPRICED (${streams?.why ?? 'no streams'})`)
  if (!num(target) || target <= 0) return no('UNPRICED (no home-tier endpoint)')
  const w = num(workerGb) && workerGb > 0 ? workerGb : 0
  const dg = num(displacedGb) && displacedGb > 0 ? displacedGb : 0
  const d = w > 0 ? Math.min(1, dg / w) : dg > 0 ? 1 : 0
  const base = { hackIncome: streams.hackIncome, hacknetIncome: streams.hacknetIncome, goPower, sf14, hackShare }
  // WITHOUT: the measured streams, from the wealth in hand.
  const withoutH = hoursTo({ start: streams.wealth, target, incomeAt: incomeAtOf({ ...base, farm: null, d: 0 }), maxH })
  if (!executable) return { ...no(`no rooted host can ever hold go.js and none can be bought`), priced: true, withoutH }
  // WITH: each money arm played from now, the displaced share gone, the upfront paid.
  const arms = {}
  let best = null
  for (const name of GO_MONEY_ARMS) {
    const pph = streams.rates?.[name]
    if (!num(pph) || pph <= 0) continue
    const farm = { name, pph, n0: num(streams.nodePower?.[name]) ? streams.nodePower[name] : 0 }
    const h = hoursTo({ start: streams.wealth - (num(upfront) ? upfront : 0), target, incomeAt: incomeAtOf({ ...base, farm, d }), maxH })
    arms[name] = h
    if (!best || h < arms[best]) best = name
  }
  if (!best) return no('UNPRICED (no measured rate for any money arm)')
  const withH = arms[best]
  const f = (h) => (isFinite(h) ? `${h.toFixed(3)}h` : `never (${maxH}h)`)
  if (!isFinite(withH) && !isFinite(withoutH)) return no(`UNPRICED: neither run reaches the endpoint within ${maxH}h (hacking $${streams.hackIncome.toFixed(2)}/s, hacknet $${streams.hacknetIncome.toFixed(0)}/s, wealth $${Math.round(streams.wealth)}, need $${Math.round(target)})`, { priced: false, withH, withoutH })
  const gainH = withoutH - withH
  const goFirst = gainH > GO_PLACE_TOL_H
  const why =
    `${sc.why}: to $${(target / 1e6).toFixed(1)}m of home RAM ${f(withH)} with go.js now (${best}, ${OPPONENTS[best].channel}, ${Math.round(streams.rates[best])}/h from n=${Math.round(streams.nodePower?.[best] ?? 0)}` +
    `${dg > 0 ? `; ${dg.toFixed(2)}GB of ${w.toFixed(1)}GB hacking workers displaced = ${(100 * d).toFixed(1)}% of $${streams.hackIncome.toFixed(2)}/s` : '; no worker displaced'}${upfront > 0 ? `; $${Math.round(upfront)} up front` : ''})` +
    ` vs ${f(withoutH)} waiting for the ${GO_BOOT_TIER}GB tier (hacking $${streams.hackIncome.toFixed(2)}/s + hacknet $${streams.hacknetIncome.toFixed(0)}/s from $${Math.round(streams.wealth)})` +
    ` -> ${goFirst ? `PLACE (${(gainH * 60).toFixed(1)} min sooner)` : `wait (${isFinite(gainH) ? `${(gainH * 60).toFixed(1)} min` : 'no gain'}, need > ${(GO_PLACE_TOL_H * 60).toFixed(0)} min)`}`
  return { goFirst, priced: true, effective: sc.effective, withH, withoutH, gainH, arm: best, arms, d, displacedGb: dg, workerGb: w, upfront: num(upfront) ? upfront : 0, target, why, notSimulated: NOT_SIMULATED }
}
