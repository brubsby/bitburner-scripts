// BN15's CHARISMA TRAJECTORY, MEASURED — which charisma multiplier each labyrinth's life would have, from the
// augmentation trajectories this stack actually played, and the lab schedule on it.
//
//   node tools/sim/chatraj.mjs [--write] [--json] [--telemetry DIR]
//
// WHY. Labs 4 and 5 need charisma 2500 / 3000 (labyrinth.ts labData); level = mult x (32 ln(exp + 534.6) - 200)
// (skill.ts), so their climb is exponential in 1/mult and the multiplier is the route (chaplan.js). lab15.mjs's
// first derivation took the charisma augmentations bought by each lab as an ASSUMED column per scenario. This
// replaces it with a measurement: every hacking-route clear in .telemetry/history.jsonl (The Red Pill installed)
// is an augmentation trajectory the stack's own buyer produced, life by life — and charisma rides along: Speech
// Processor, Nuoptimal, Speech Enhancement (Tian Di Hui, city factions), Magnetism (The Black Hand), Neural Wit
// (BitRunners), SmartJaw / Social Dynamics / ADR-V2 / nextSENS (corporations), every NeuroFlux level (+1%).
//
// WHAT IS MEASURED, per clear and per life (the span between two installs; history.jsonl rows):
//   prod   the installed augmentations' charisma product, NeuroFlux included: the catalogue's mults.charisma over
//          the life's installed list (Augmentations.ts), x the NeuroFlux factor recovered from the life's own
//          charisma level and exp (skill.ts calculateSkill inverted: liveMult / (Source-Files x node x the
//          catalogue product); history.jsonl lists NeuroFlux once, without its level). A life whose charisma
//          level is under NFG_MIN_LEVEL reads the factor as 1 (a floor: the level's rounding is too coarse).
//   lenH   the life's length; ram the home RAM in it (the farm's ceiling, with chaplan's FARM_MAX_GB)
// THE TRANSFER TO BN15 (ASSUMED, stated): the clear's life structure in units of its node's length (phi = t / T)
// is the BN15 hacking route's, T15 = TRANSFER.T15 (the gameplan's BN15 hacking arm, routes.mjs); the charisma
// product is the clear's (the stack's buyer, not valuing charisma) — a FLOOR for the lab route, where augplan
// values charisma (objective.charismaValue) and buys it on purpose. AugmentationMoneyCost 3 in BN15 is printed
// beside each clear's own (a clear at a higher cost is the better witness).
//
// THE LAB SCHEDULE on a clear (labScheduleOf): lab k (k = 1..5) is cleared in the first life j whose climb (exp 0
// at the life's start: an install resets it — chaplan.climbOf at BASE x the lab augmentations installed by then
// x prod_j, on min(ram_j, FARM_MAX_GB)) plus its crawl (lab15.mjs CRAWL_MIN, measured) fits inside the life,
// one lab per life (its reward is installed: dnetplan.labInstallOf, the install ends that life). Lab 5 (The Red
// Pill) must clear in a life before the final window; a lab that fits no life is HELD in the last pre-final
// life — the install held until the climb completes (the hours past the life's end are the route's) — and a
// climb past chaplan.CLIMB_CAP_H FAILS the route there (the black ops' fallback). The leg the lab route adds to
// the hacking route = the holds + LAB_INSTALL_H per forced lab install (labs 1-4: an install the hacking route
// would have made later). The farm and the crawl run in parallel with the hacking route (scripts on free RAM,
// no work slot); NOT PRICED: the farm's home RAM against the batcher's money (late lives: a 900GB farm on a
// multi-TB home).
//
// OUTPUT (--write): tools/sim/chatraj.json — per clear the lives and the schedule, and the scenario columns
// lab15.mjs prices (lo/mid/hi = the clears' leg quantiles, FAIL counted as the cap) and the band the live
// health check reads (chaplan.LAB_TRAJ: the multiplier the trajectory has by each node fraction).
//
// CALIBRATION: the per-life product is the game's catalogue over the game's own installed list; the NeuroFlux
// factor checks itself (printed per clear: its implied level). NOT CALIBRATED: the transfer (no BN15 life has
// been played) — which is why the live arm re-prices from the live multiplier every pass and LAB CLIMB STALLED
// fires when the live multiplier falls under this band.
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import g, { setBitNode } from './nodechoice/game.mjs'
import { isNewClear, TELEMETRY } from './nodechoice/measure.mjs'
import { sfMults } from './nodechoice/hackexit.mjs'
import { labScheduleOf, LAB_INSTALL_H, FARM_MAX, FARM_MAX_GB, trajBandOf, farmRateOf, trajLivesOf, CRAWL_MIN } from '../../chaplan.js'
import { BASE } from './lab15.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
/** The BN15 hacking route's length the clears' structure is scaled to (routes.mjs 'lab': the hack arm the first slice priced). */
export const TRANSFER = { T15: 34.5, why: "the gameplan's BN15 hacking arm (routes.mjs 'lab' = hack + LAB15; 34.5h, CLAUDE.md BN15 plan)" }
export const NFG_MIN_LEVEL = 100
const NFG = 'NeuroFlux Governor'

/** NeuroFlux levels by install time from installs.jsonl (its early rows list `after` with levels): [{t, level}]. */
export function nfgLedgerOf(file) {
  if (!file || !fs.existsSync(file)) return []
  const out = []
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    let r
    try {
      r = JSON.parse(line)
    } catch {
      continue
    }
    const a = Array.isArray(r.after) ? r.after.find((x) => x?.name === NFG) : null
    if (a && Number.isFinite(a.level) && Date.parse(r.at)) out.push({ t: Date.parse(r.at), level: a.level })
  }
  return out
}
/** Within a life the factor is constant: the median of its rows, the first and last LIFE_EDGE_H skipped (an install's row reads the old level over the new exp). */
export const LIFE_EDGE_H = 0.1

/** The hacking-route clears in history.jsonl: per clear its lives with the measured product, length and home RAM. */
export async function measureClears(file = path.join(process.env.TELEMETRY ?? TELEMETRY, 'history.jsonl')) {
  setBitNode(15, 1)
  const ledger = nfgLedgerOf(path.join(path.dirname(file), 'installs.jsonl'))
  const segs = []
  let cur = null
  let prevP = null
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity })
  for await (const line of rl) {
    let r
    try {
      r = JSON.parse(line)
    } catch {
      continue
    }
    if (typeof r.bitNode !== 'number' || typeof r.totalPlaytime !== 'number') continue
    if (isNewClear(cur, r.bitNode, r.sourceFiles?.data)) {
      cur = { bitNode: r.bitNode, sfOnEntry: r.sourceFiles?.data ?? [], t0: r.totalPlaytime, at0: r.at, rows: [], installs: [], trp: false }
      segs.push(cur)
      prevP = null
    }
    const h = (r.totalPlaytime - cur.t0) / 3.6e6
    const p = r.playtimeSinceLastAug
    if (prevP !== null && typeof p === 'number' && p < prevP - 60e3) cur.installs.push(h)
    prevP = p
    const names = (r.augmentations ?? []).map((a) => (typeof a === 'string' ? a : a?.name))
    if (names.includes('The Red Pill')) cur.trp = true
    cur.names = names
    let prod = 1
    for (const n of names) {
      if (n === NFG) continue
      const A = g.Augmentations[n]
      if (A) prod *= A.mults.charisma ?? 1
    }
    const lv = r.skills?.charisma
    const ex = r.exp?.charisma
    const d = typeof ex === 'number' ? 32 * Math.log(ex + 534.6) - 200 : null
    cur.rows.push({ h, t: Date.parse(r.at), prod, hasNfg: names.includes(NFG), liveMult: lv >= NFG_MIN_LEVEL && d > 0 ? lv / d : null, ram: r.home?.ram ?? null, life: cur.installs.length })
  }
  const clears = []
  for (const s of segs) {
    const T = s.rows.at(-1)?.h ?? 0
    if (!s.trp || T < 5 || s.installs.length < 2) continue
    const m = g.getBitNodeMultipliers(s.bitNode, 1)
    const sfCha = sfMults(s.sfOnEntry).charisma
    const bounds = [0, ...s.installs, T]
    const lives = []
    for (let j = 0; j + 1 < bounds.length; j++) {
      const rows = s.rows.filter((x) => x.life === j)
      if (!rows.length) continue
      // the product the life RUNS at: its installed list (constant within a life), the NeuroFlux factor from the
      // life's best-resolved rows (the highest charisma level)
      const prodCat = rows[rows.length - 1].prod
      // the NeuroFlux level: the install ledger's (its level after the install that opened this life), else
      // recovered from the life's interior rows (median), else none (a floor)
      const t0 = rows[0].t
      const led = j > 0 ? ledger.filter((x) => Math.abs(x.t - t0) < 20 * 60e3).sort((a, b) => Math.abs(a.t - t0) - Math.abs(b.t - t0))[0] : null
      const lm = rows.filter((x) => x.liveMult && x.h >= bounds[j] + LIFE_EDGE_H && x.h <= bounds[j + 1] - LIFE_EDGE_H).map((x) => x.liveMult).sort((a, b) => a - b)
      const fromLive = lm.length && rows[0].hasNfg ? Math.max(1, lm[Math.floor(lm.length / 2)] / (sfCha * m.CharismaLevelMultiplier * prodCat)) : null
      const nfgLevel = led ? led.level : fromLive !== null ? Math.round(Math.log(fromLive) / Math.log(1.01)) : 0
      const nfgF = 1.01 ** nfgLevel
      lives.push({ j, startH: bounds[j], lenH: bounds[j + 1] - bounds[j], prodCat: +prodCat.toFixed(4), nfgLevel, nfgFrom: led ? 'installs.jsonl' : fromLive !== null ? 'live charisma' : 'none (floor)', prod: +(prodCat * nfgF).toFixed(4), ram: Math.max(0, ...rows.map((x) => x.ram ?? 0)) })
    }
    clears.push({ bitNode: s.bitNode, startedAt: s.at0, T: +T.toFixed(2), installs: s.installs.length, amc: m.AugmentationMoneyCost, sfCha: +sfCha.toFixed(4), lives, names: new Set(s.names ?? []) })
  }
  return clears
}

/**
 * THE COMPACT TRAJECTORY (labtraj.js LAB_TRAJ.clears): per clear its lives as [start/T, len/T, product, farm GB]
 * — the product made MONOTONE (a running max: installed augmentations and NeuroFlux levels only grow within a
 * node, so a dip is a NeuroFlux level the history could not read, never a loss), the farm's RAM the home RAM
 * capped at FARM_MAX_GB.
 */
export function compactOf(c) {
  let m = 0
  return {
    bn: c.bitNode,
    at: c.startedAt.slice(0, 10),
    T: c.T,
    amc: c.amc,
    installs: c.installs,
    lives: c.lives.map((l) => {
      m = Math.max(m, l.prod)
      return [+(l.startH / c.T).toFixed(4), +(l.lenH / c.T).toFixed(4), +m.toFixed(4), Math.min(l.ram || 0, FARM_MAX_GB)]
    }),
  }
}

/** A compact clear's lab schedule on BN15's clock (phi x T15). */
export function scheduleOfClear(t, { T15 = TRANSFER.T15, crawlMin = CRAWL_MIN, base = BASE } = {}) {
  return labScheduleOf({ lives: trajLivesOf(t, T15), base, crawlMin })
}

const quant = (xs, p) => {
  const v = [...xs].sort((a, b) => a - b)
  if (!v.length) return null
  const i = (v.length - 1) * p
  const lo = Math.floor(i)
  const hi = Math.min(v.length - 1, lo + 1)
  if (!Number.isFinite(v[lo]) || !Number.isFinite(v[hi])) return v[hi] === Infinity || v[lo] === Infinity ? Infinity : null
  return v[lo] + (v[hi] - v[lo]) * (i - lo)
}

/** The scenario columns lab15.mjs prices, the live band and the labs' due fractions (labtraj.js) from the compact clears. */
export function summarize(trajs, opts = {}) {
  const T15 = opts.T15 ?? TRANSFER.T15
  const rows = trajs.map((t) => ({ t, s: scheduleOfClear(t, opts) }))
  const legs = rows.map((r) => r.s.legH)
  // when each lab is installed (its clear; lab 5's the terminal install) as a node fraction, per clear (a failed or held lab: never in time)
  const labDue = [1, 2, 3, 4, 5].map((k) => {
    const ph = rows.map((r) => {
      const l = r.s.labs.find((x) => x.lab === k)
      return l && !l.held && Number.isFinite(l.atH) ? l.atH / T15 : Infinity
    })
    const q75 = quant(ph, 0.75)
    return { lab: k, q50: quant(ph, 0.5), q75: Number.isFinite(q75) ? +q75.toFixed(4) : null }
  })
  const finals = trajs.map((t) => t.lives.at(-1)?.[1]).filter(Number.isFinite)
  return {
    n: rows.length,
    fails: rows.filter((r) => r.s.failed).length,
    leg: { lo: quant(legs, 0.25), mid: quant(legs, 0.5), hi: quant(legs, 0.75), max: Math.max(...legs) },
    band: trajBandOf(trajs.map((t) => ({ T: 1, lives: t.lives.map(([s, , p]) => ({ startH: s, prod: p })) }))),
    labDue,
    finalFrac: +quant(finals, 0.5).toFixed(4),
    rows,
  }
}

/** THE CATALOGUE AT BN15 (game source): every charisma augmentation, its factions with their invitation gates, rep and price x AugmentationMoneyCost, and how many measured clears installed it. */
export function catalogueOf(clears) {
  const m = setBitNode(15, 1)
  const out = []
  for (const A of Object.values(g.Augmentations)) {
    const c = A.mults?.charisma ?? 1
    const ce = A.mults?.charisma_exp ?? 1
    if (!(c > 1 || ce > 1) || A.name === NFG) continue
    const facs = Object.values(g.Factions).filter((f) => f.augmentations?.includes?.(A.name))
    out.push({
      name: A.name,
      charisma: +c.toFixed(4),
      charismaExp: +ce.toFixed(4),
      price: A.baseCost * m.AugmentationMoneyCost,
      rep: A.baseRepRequirement * m.AugmentationRepCost,
      prereqs: A.prereqs ?? [],
      factions: facs.map((f) => ({ name: f.name, gates: (() => { try { return f.getInfo().inviteReqs.map((r) => r.toJSON?.() ?? String(r)) } catch { return null } })() })),
      boughtBy: clears.filter((x) => x.names?.has?.(A.name)).length,
    })
  }
  return out.sort((a, b) => b.charisma - a.charisma)
}

/** The charisma exp sources beside the farm (game source), per second at charisma `cha`: the course and the sleeves are a rounding error. */
export function expSourcesOf({ cha, expMult = BASE.expMult, int = BASE.int, sleeves = 8 }) {
  // ClassWork.tsx:52 Leadership chaExp 4 / s at a location's expMult; LocationsMetadata.ts ZB Institute expMult 4 (the best);
  // Formulas.ts calculateClassEarnings x the person's charisma_exp
  const course = 4 * 4 * expMult
  // Sleeve/Work/Work.ts applySleeveGains: the player receives the sleeve's gains x its sync (<= 1), without the player's own multipliers
  const sleeveUpper = sleeves * 4 * 4 * 1
  const farm = farmRateOf({ cha, workers: FARM_MAX, expMult, int })
  return { cha, farm: Math.round(farm), course: +course.toFixed(1), sleevesUpper: sleeveUpper, sideShare: +((course + sleeveUpper) / farm).toExponential(2) }
}

/** The root module the live arm and the health check read: LAB_TRAJ (generated, never edited by hand). */
export const LABTRAJ_FILE = path.join(HERE, '../../labtraj.js')
export function labTrajSource(trajs, sum) {
  const data = { measuredAt: new Date().toISOString().slice(0, 10), source: 'tools/sim/chatraj.mjs --write (history.jsonl hacking-route clears)', transfer: TRANSFER, n: sum.n, fails: sum.fails, leg: { lo: +sum.leg.lo.toFixed(3), mid: +sum.leg.mid.toFixed(3), hi: Number.isFinite(sum.leg.hi) ? +sum.leg.hi.toFixed(3) : null }, finalFrac: sum.finalFrac, labDue: sum.labDue, band: sum.band, clears: trajs }
  return `// GENERATED by tools/sim/chatraj.mjs --write — never edit by hand (tools/test/labroute.test.mjs checks it reproduces).
// BN15's charisma trajectory, MEASURED: the hacking-route clears in .telemetry/history.jsonl, per clear its lives as
// [start / T, length / T, the installed charisma product (NeuroFlux included, monotone), the farm's RAM (GB, capped)].
// Pure data: no ns. Read by labroute.js (the lab arm, LAB CLIMB STALLED) and tools/sim/lab15.mjs (routes.mjs LAB15).
export const LAB_TRAJ = ${JSON.stringify(data)}
`
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const tdir = process.argv.includes('--telemetry') ? process.argv[process.argv.indexOf('--telemetry') + 1] : null
  const clears = await measureClears(tdir ? path.join(tdir, 'history.jsonl') : undefined)
  const trajs = clears.map(compactOf)
  const sum = summarize(trajs)
  if (process.argv.includes('--json')) console.log(JSON.stringify({ clears, sum: { ...sum, rows: undefined } }, null, 1))
  else {
    console.log(`BN15 charisma trajectory: ${sum.n} hacking-route clears (The Red Pill installed), transferred to T15 ${TRANSFER.T15}h (${TRANSFER.why}); base ${BASE.mult.toFixed(3)}, farm <= ${FARM_MAX_GB}GB, lab install ${LAB_INSTALL_H}h`)
    for (const [i, { s }] of sum.rows.entries()) {
      const c = clears[i]
      const tail = c.lives.slice(-4).map((l) => `${l.prod.toFixed(2)}(nfg ${l.nfgFrom === 'none (floor)' ? '?' : l.nfgLevel})`).join(' ')
      console.log(`  BN${c.bitNode} ${c.startedAt.slice(0, 10)} T ${c.T}h ${c.installs} installs AMC ${c.amc} | last lives' product ${tail} | labs in lives ${s.labs.map((l) => (l.life === null ? 'X' : l.life)).join('/')} at mult ${s.labs.map((l) => (l.mult ? l.mult.toFixed(2) : '?')).join('/')} | leg ${s.legH.toFixed(2)}h${s.failed ? ' FAILS' : ''}${s.heldH > 0 ? ` (held ${s.heldH.toFixed(2)}h)` : ''} | lab 5 at ${s.doneH !== null ? s.doneH.toFixed(1) + 'h' : '-'}`)
    }
    console.log(`  leg quantiles: lo(25%) ${sum.leg.lo?.toFixed(2)}h mid ${sum.leg.mid?.toFixed(2)}h hi(75%) ${sum.leg.hi?.toFixed(2)}h max ${sum.leg.max.toFixed(2)}h; ${sum.fails}/${sum.n} clears FAIL (a lab past the climb cap); final window ${sum.finalFrac} of T`)
    console.log(`  labs installed by node fraction (q50 / q75 over clears): ${sum.labDue.map((d) => `lab ${d.lab} ${d.q50?.toFixed?.(2) ?? d.q50}/${d.q75 ?? 'never'}`).join(', ')}`)
    console.log(`  band (the product by node fraction): ${sum.band.map((b) => `${b.phi}: q10 ${b.q10} q50 ${b.q50} q75 ${b.q75}`).join(' | ')}`)
    if (process.argv.includes('--catalogue')) {
      console.log('  THE CATALOGUE AT BN15 (AugmentationMoneyCost 3; game source):')
      for (const a of catalogueOf(clears)) console.log(`    x${a.charisma} (exp x${a.charismaExp}) ${a.name}: $${a.price.toExponential(2)}, ${a.rep.toExponential(2)} rep — ${a.factions.map((f) => `${f.name} [${(f.gates ?? []).map((q) => JSON.stringify(q)).join(' ')}]`).join('; ')}`)
      console.log('  THE OTHER CHARISMA EXP SOURCES (per second; the farm at FARM_MAX one-thread workers):')
      for (const cha of [10, 300, 1500, 2500]) console.log(`    ${JSON.stringify(expSourcesOf({ cha }))}`)
      console.log('    SF15: no charisma level or exp effect (applySourceFile.ts:173-177); SF15.2 speeds authentication x0.8 (effects.ts:80) — not held at BN15.1')
    }
  }
  if (process.argv.includes('--write')) {
    fs.writeFileSync(LABTRAJ_FILE, labTrajSource(trajs, sum))
    console.log(`wrote ${LABTRAJ_FILE}`)
  }
  process.exit(0)
}
