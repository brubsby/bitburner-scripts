// CORPORATION — is one worth founding in the nodes still owed? (2026-10-24, SF3.3 held)
//
//   node tools/sim/corpcheck.mjs [--nodes 5.2,5.3,8.2,8.3,2.2,2.3] [--json]
//
// NOT CALIBRATED live: no corporation has ever run on this save, so no corp quantity can be
// checked against the game. The decision below does not rest on a corp model: it rests on two
// gates read from source and from the live history, and on an upper bound measured in the
// game's own Bladeburner classes. If a gate ever opens, the corp itself must be simulated
// (bundle src/Corporation like tools/sim/nodechoice) before anything is built.
//
// THE TWO TRAJECTORIES (CLAUDE.md "Decisions compare simulated trajectories"): the node's exit
// with a corp founded the moment cash first covers its price, vs the same node without. Until
// that moment the two are the same trajectory, so:
//   1. A node whose multipliers disable the corp has with == without: 0h, exactly.
//      canCreateCorporation (src/Corporation/helpers.ts:64-78): outside BN3 only self-funded,
//      and refused when CorporationSoftcap < 0.15 (helpers.ts:74). BN8: CorporationSoftcap 0,
//      CorporationValuation 0, CorporationDivisions 0 (src/BitNode/BitNode.tsx, case 8).
//   2. A node whose cash never reaches the price before its exit has with == without: 0h.
//      Price $150b (costOfCreatingCorporation, helpers.ts:80-85; Corporation.funds starts at it,
//      Corporation.ts:41). The cash trajectory is the live history's: every Bladeburner-route
//      node played since the route went live (printed below, peak cash per node).
//   3. Where the corp could start, its money reaches the player only by dividends
//      (Corporation.ts getCycleDividends: (rate x profit x ownership x 10s)^(1 - tribute),
//      tribute = 1.15 - CorporationSoftcap, Corporation.ts:54) or by selling shares once public
//      (Actions.ts sellShares, 1h cooldown, price from valuation x CorporationValuation). Investor
//      rounds and bribes pay the corporation, not the player; a bribe buys rep only from factions
//      that offer work (Actions.ts:612-650; the Bladeburners faction does not) and only past a
//      $100t valuation. On the Bladeburner route (no installs, the plan's "never") money buys
//      only grafts and the Simulacrum, so the value of ANY money is bounded by bbgraft.mjs's
//      graft gain at unlimited money minus its gain at the node's own money: GRAFT_BOUND below,
//      measured with `node tools/sim/bbgraft.mjs --node N --l6 3 --l7 3 --sf14 3 --n 8 --money L`.
//
// RAM (the game's RamCostGenerator.ts:13-14, :475-551: 10GB per info call, 20GB per action): a
// steady-state manager (offices, products, pricing, research, upgrades) references ~12 actions
// and ~10 infos = ~340GB; setup + exits (create, expand, warehouses, unlocks, exports,
// investment, public, shares, dividends) another ~310GB. Split one action per script it is
// 21.6-31.6GB a call. The BN5.2 entry dry-run already cannot place bladeburner.js (92.75GB) at
// entry (.telemetry/entry-dryrun.json).

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import g from './nodechoice/game.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TEL = process.env.TELEMETRY ?? path.resolve(HERE, '../../.telemetry')
export const PRICE = 150e9 // helpers.ts:80-85, self-funded
export const SOFTCAP_MIN = 0.15 // helpers.ts:74

/**
 * Graft gain (hours) on the Bladeburner route by money level, bbgraft.mjs, 4 paired seeds, SF6.3
 * SF7.3 SF14.3, 8 sleeves, decided 0.5h after the join; 'max' = $1e17 + $1e17/h (unlimited).
 */
export const GRAFT_BOUND = {
  // measured 2026-10-24: money saturates at 'mid' ($1e11 + $1e10/h, below the corp's own $150b
  // price): rich and unlimited buy the identical schedule on every seed.
  5: { poor: 0.511, mid: 1.603, rich: 1.594, max: 1.594 },
  2: { poor: 0.336, mid: 1.484, rich: 1.484, max: 1.484 },
}

/** The corp's gate in node n at level lvl, from the game's own multiplier table. */
export function corpGateOf(n, lvl = 1) {
  const m = g.getBitNodeMultipliers(n, lvl)
  const open = n === 3 || m.CorporationSoftcap >= SOFTCAP_MIN
  return { node: n, open, softcap: m.CorporationSoftcap, valuation: m.CorporationValuation, divisions: m.CorporationDivisions, tribute: 1.15 - m.CorporationSoftcap }
}

/** Live history: per node segment, its length, peak cash and the hour cash first covered PRICE. */
export function cashSegments(file = path.join(TEL, 'history.jsonl')) {
  if (!fs.existsSync(file)) throw new Error(`no history at ${file} — set TELEMETRY to the live .telemetry directory`)
  const segs = []
  let cur = null
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue
    let r
    try { r = JSON.parse(line) } catch { continue }
    const key = `${r.bitNode}|${JSON.stringify(r.sourceFiles?.data ?? [])}`
    const t = Date.parse(r.at) / 3.6e6
    if (!cur || cur.key !== key) segs.push((cur = { key, node: r.bitNode, start: r.at, t0: t, h: 0, peak: 0, atPrice: null }))
    cur.h = t - cur.t0
    cur.peak = Math.max(cur.peak, r.money ?? 0)
    if (cur.atPrice === null && (r.money ?? 0) >= PRICE) cur.atPrice = cur.h
  }
  return segs.filter((s) => s.h >= 1)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d)
  const owed = opt('nodes', '5.2,5.3,8.2,8.3,2.2,2.3').split(',').map((s) => s.split('.').map(Number))
  console.log('NOT CALIBRATED live (no corporation has run on this save); gates from source + live history, bound from bbgraft.mjs')
  const out = { gates: [], recentBlade: [], nodes: [] }
  for (const [n, l] of owed) out.gates.push({ ...corpGateOf(n, l), lvl: l })
  // the Bladeburner-route nodes since the route's automation went live (BN6.2 on, 2026-10-13)
  const segs = cashSegments().filter((s) => s.start >= '2026-10-13T20')
  for (const s of segs) out.recentBlade.push({ node: s.node, start: s.start.slice(0, 16), h: +s.h.toFixed(1), peak: s.peak, atPrice: s.atPrice === null ? null : +s.atPrice.toFixed(1) })
  console.log('\ncash per node since 2026-10-13 (live history.jsonl; the corp needs $1.5e11 cash):')
  for (const s of out.recentBlade) console.log(`  BN${s.node} ${s.start}  ${String(s.h).padStart(5)}h  peak $${s.peak.toExponential(2)}  ${s.atPrice === null ? 'never reached $150b' : `$150b at ${s.atPrice}h`}`)
  console.log('\nper owed node:')
  for (const gt of out.gates) {
    const b = GRAFT_BOUND[gt.node]
    let hours = 0
    let why
    if (!gt.open) why = `corporation disabled (CorporationSoftcap ${gt.softcap} < ${SOFTCAP_MIN}, helpers.ts:74): with == without, 0h exactly`
    else {
      const bound = b?.max != null && b?.mid != null ? Math.max(0, b.max - Math.min(b.mid, b.poor ?? b.mid)) : null
      why = `open (softcap ${gt.softcap}, dividends ^${(1 - gt.tribute).toFixed(2)}, valuation x${gt.valuation}); ` +
        `Bladeburner route: ${segs.filter((s) => s.atPrice === null).length} of the last ${segs.length} nodes never held $150b cash (no fork: 0h); ` +
        `where cash does reach $150b the graft schedule is already the unlimited-money one (it saturates at $1e11 + $1e10/h), so the corp adds 0h and costs its price and RAM; ` +
        `ceiling on ANY money from t 0 (graft gain unlimited - poor, bbgraft): ${bound === null ? 'not measured' : `${bound.toFixed(2)}h`}`
    }
    out.nodes.push({ node: `${gt.node}.${gt.lvl}`, hours, why })
    console.log(`  BN${gt.node}.${gt.lvl}: ${hours}h — ${why}`)
  }
  if (args.includes('--json')) console.log(JSON.stringify(out))
  process.exit(0) // the game bundle keeps timers alive
}
