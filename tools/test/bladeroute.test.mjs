// THE BLADEBURNER ROUTE in the plan layer (plan.decideBladeRouteGen, wired
// in progress.js bladeRouteOf), replayed on a BN6 ENTRY as the planner prices
// it: the hacking arm is exitplan on BN6's fresh-entry inputs with our stack
// (tools/sim/nodechoice/hackexit.mjs freshInputs — the same builder
// nextnode.mjs and bb6.mjs use) at the measured economy latent g, the draws
// are the BN9 13:41 pass's posterior (fixture-bn9-plancpu-1341.json; no BN6
// posterior exists until BN6 is played), and the Bladeburner arm starts from
// a fresh BN6 division or from one a black op from the end.
//
//   BR1  the plan picks the FASTER route: BN6 entry at the lo economy (BN8-like g) -> 'blade'; at
//        the hi economy (BN2-like g) -> 'hack'; a division one black op from the end -> 'blade'
//   BR2  it is a comparison of two simulated trajectories on the same draws (both rows priced, n
//        draws each, the record is decideAmongGen's on the same options) — not a formula for the delta
//   BR3  CPU: in a pacer at the plan's slice the longest step stays under sliceMs/2, the blade arm
//        runs one simulation per cadence step (<= 8 even on a wide posterior), and the decision fits the plan budget
//   BR4  the wiring (source guards): progress.js decides through decideBladeRouteGen, gives the slot to
//        'bladeburner' only on the committed route, in the division, with no body leg; the gym to
//        combat 100 is a body leg; plan.txt publishes decisions.bladeRoute and the blade exit
//   BR5  the exit: endgame.js reads the black ops from the game before the World Daemon, and the
//        Bladeburner exit goes through leave() (hold file, --next) — bladeburner.js never destroys

import './gameresolve.mjs'
import { Check } from './harness.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from './gameresolve.mjs'

const P = await import('plan.js')
const BB = await import('bbplan.js')
const { makePacer } = await import('coop.js')

const F = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tools/test/fixture-bn9-plancpu-1341.json'), 'utf8'))
function postOf(ps) {
  const c = ps.cadence
  return {
    drift: { s: ps.s, nu: ps.driftNu ?? 4, a: 2, b: 2 * ps.s * ps.s },
    gymSdLn: 0.1,
    cadence: c ? { rate: { mean: Math.log(c.lnPerHour), sd: c.rateSdLn }, life: { mean: Math.log(c.cycleHours), sd: c.lifeSdLn }, own: { weight: c.ownWeight } } : null,
    expPost: ps.exp ? { perSec: ps.exp.perSec, sd: ps.exp.sdLn } : null,
    income: ps.income ? { perSec: ps.income.perSec, mean: Math.log(ps.income.perSec), sd: ps.income.sdLn } : null,
  }
}
// The 13:41 pass's structural (drift) posterior only: its income, exp and
// cadence posteriors are BN9's measurements and would be drawn into BN6's
// entry inputs (applyDraw replaces those inputs) — a BN6 entry has none yet.
const DRAWS = P.makeDraws({ ...postOf(F.posteriors1341), cadence: null, expPost: null, income: null }, P.PLAN.N, P.seedOf(1790660521043, 9))
const { freshInputs, defaultProfile } = await import('../sim/nodechoice/hackexit.mjs')
const SF = [[1, 3], [2, 1], [4, 2], [5, 1], [8, 1], [9, 1], [10, 1]]
// tools/sim/bb6.mjs's measured latents (2026-09-30): g lo 0.0405, hi 0.1381; median life 2.63h.
const PROFILE = defaultProfile({ cycleHours: 2.63 })
const INPUTS_LO = freshInputs({ node: 6, sf: SF, g: 0.0405, profile: PROFILE })
const INPUTS_HI = freshInputs({ node: 6, sf: SF, g: 0.1381, profile: PROFILE })
const INPUTS = INPUTS_LO

// A BN6 player: SF1.3-ish multipliers (level mults include BN6's 1.0 combat).
const mults = { strength: 1.12, defense: 1.12, dexterity: 1.12, agility: 1.12, charisma: 1.12, strength_exp: 1.15, defense_exp: 1.15, dexterity_exp: 1.15, agility_exp: 1.15, charisma_exp: 1.15, bladeburner_success_chance: 1, bladeburner_max_stamina: 1, bladeburner_stamina_gain: 1 }
const fresh = { skills: { hacking: 300, strength: 20, defense: 20, dexterity: 20, agility: 20, charisma: 20, intelligence: 131 }, exp: {}, mults }
const veteranPerson = { skills: { hacking: 900, strength: 300, defense: 300, dexterity: 300, agility: 300, charisma: 250, intelligence: 131 }, exp: Object.fromEntries(['strength', 'defense', 'dexterity', 'agility', 'charisma'].map((k) => [k, BB.expForLevel(300, 1.12)])), mults }
const veteranTel = {
  joined: true, rank: 399000, skillPoints: 0, blackOps: { done: 20 },
  levels: { "Blade's Intuition": 260, 'Digital Observer': 230, 'Short-Circuit': 110, Cloak: 130, Reaper: 190, 'Evasive System': 190, Overclock: 90, "Cyber's Edge": 80, Tracer: 5 },
}
const startAt = (person, tel) => (cyc) => BB.bladeStartOf({ tel, person, sleeves: { infiltrate: 5, support: 0, fa: 0 }, gymExpPerSec: 37.661, install: cyc > 0 ? { everyH: cyc, firstH: cyc, combatGain: 1 } : null })

// A fresh entry has no committed install: the default policy (exitplan.bestExitPolicy).
const BASIS = null
async function decide(bladeStartAt, base = INPUTS, sliceMs = P.PLAN.sliceMs) {
  const pacer = makePacer({ sliceMs, yieldFn: async () => {} })
  const traj = P.trajectoryOf(BASIS)
  const d = await pacer.slices(P.decideBladeRouteGen({ base, traj, basis: BASIS, bladeStartAt, prev: null, draws: DRAWS, redecide: true, budgetMs: 1e9, clock: pacer.cpuNow }), 'bladeRoute')
  return { d, stats: pacer.stats.sections.bladeRoute ?? pacer.stats }
}

export async function run() {
  const checks = []
  await decide(startAt(veteranPerson, veteranTel)) // warm: the page runs this every pass, its JIT is warm
  const vet = await decide(startAt(veteranPerson, veteranTel))
  const frs = await decide(startAt(fresh, null))
  const rich = await decide(startAt(fresh, null), INPUTS_HI)

  const c1 = new Check('BR1', 'the plan picks the faster route: BN6 entry at the lo economy -> blade, at the hi economy -> hack, one black op from the end -> blade')
  checks.push(c1)
  for (const [name, r, want] of [['BN6 entry, lo g', frs, 'blade'], ['BN6 entry, hi g', rich, 'hack'], ['one black op from the end', vet, 'blade']]) {
    c1.examined(1)
    c1.note(`${name}: hack ${r.d.hackH}h vs blade ${r.d.bladeH}h -> ${r.d.key} (mean ${r.d.meanH?.toFixed?.(1)}h, P(best) ${r.d.options?.find((o) => o.key === r.d.key)?.pBest ?? '-'})`)
    const faster = typeof r.d.bladeH === 'number' && (typeof r.d.hackH !== 'number' || r.d.bladeH < r.d.hackH) ? 'blade' : 'hack'
    if (faster !== want) c1.fail(`fixture: '${name}' must have '${want}' as the faster point (blade ${r.d.bladeH} vs hack ${r.d.hackH}) — the replay no longer tests what it claims`)
    if (r.d.key !== want) c1.fail(`${name}: the plan chose '${r.d.key}', the faster route is '${want}'`, String(r.d.why ?? '').slice(0, 240))
  }

  const c2 = new Check('BR2', 'a comparison of two simulated trajectories on the same draws, not a formula for the delta')
  checks.push(c2)
  for (const [name, r, base] of [['veteran', vet, INPUTS], ['fresh', frs, INPUTS], ['rich', rich, INPUTS_HI]]) {
    c2.examined(1)
    const keys = (r.d.options ?? []).map((o) => o.key).sort().join(',')
    if (keys !== 'blade,hack') c2.fail(`${name}: the record must carry both priced options (got '${keys}')`)
    if (!(r.d.n === DRAWS.length)) c2.fail(`${name}: priced on ${r.d.n} of ${DRAWS.length} draws with an unlimited budget`)
    // Each option row carries ITS OWN point (the published pair must not be crossed).
    const row = (k) => (r.d.options ?? []).find((o) => o.key === k)
    const r3 = (x) => (typeof x === 'number' ? +x.toFixed(3) : x)
    if (!(r3(row('hack')?.pointH) === r3(r.d.hackH) && r3(row('blade')?.pointH) === r3(r.d.bladeH))) c2.fail(`${name}: option points crossed — hack row ${row('hack')?.pointH} vs hackH ${r.d.hackH}, blade row ${row('blade')?.pointH} vs bladeH ${r.d.bladeH}`)
    // The same options through decideAmong directly: identical key (the record IS the shared rule's).
    const traj = P.trajectoryOf(BASIS)
    const memo = new Map()
    const st = name === 'veteran' ? startAt(veteranPerson, veteranTel) : startAt(fresh, null)
    const blade = (d) => {
      const c0 = base.cycleHours
      const k = Math.round(Math.log(P.applyDraw(base, d).cycleHours / c0) / 0.25)
      if (!memo.has(k)) memo.set(k, BB.bladeExit(st(c0 * Math.exp(0.25 * k))).hours)
      return memo.get(k)
    }
    const ref = P.decideAmong({ options: [{ key: 'hack', noiseKey: P.noiseKeyOf(BASIS, base), sim: (d) => traj(P.applyDraw(base, d), d) }, { key: 'blade', noiseKey: 'bladeburner', sim: blade }], draws: DRAWS, redecide: true, budgetMs: 1e9 })
    if (ref.key !== r.d.key) c2.fail(`${name}: decideBladeRouteGen chose '${r.d.key}', the shared rule on the same two trajectories chose '${ref.key}'`)
    if (!(Math.abs((ref.meanH ?? 0) - (r.d.meanH ?? 0)) < 1e-9)) c2.fail(`${name}: mean ${r.d.meanH} vs the shared rule's ${ref.meanH}`)
  }

  const c3 = new Check('BR3', `CPU: longest step < sliceMs/2 (${P.PLAN.sliceMs / 2}ms), a handful of blade simulations (one per cadence step), total within the plan budget (${P.PLAN.budgetMs}ms)`)
  checks.push(c3)
  for (const [name, r] of [['veteran', vet], ['fresh', frs]]) {
    c3.examined(1)
    const step = r.stats.maxStepMs ?? null
    const cpu = r.stats.cpuMs ?? null
    c3.note(`${name}: ${r.d.bladeSims} blade simulation(s), longest step ${step?.toFixed?.(1)}ms, ${cpu?.toFixed?.(0)}ms of work`)
    if (!(step < P.PLAN.sliceMs / 2)) c3.fail(`${name}: a step held the page ${step}ms (>= ${P.PLAN.sliceMs / 2})`)
    // One simulation per cadence step and member (bbplan.BLADE_ENSEMBLE: Q members, the point their mean).
    if (!(r.d.bladeSims >= 1 && r.d.bladeSims <= 8 * BB.BLADE_ENSEMBLE.Q)) c3.fail(`${name}: ${r.d.bladeSims} blade simulations (the cadence memo is not holding)`)
    if (!(cpu <= P.PLAN.budgetMs)) c3.fail(`${name}: ${cpu}ms of work for one decision (plan budget ${P.PLAN.budgetMs}ms)`)
  }

  // With a WIDE cadence posterior (the BN9 pass's own): still a handful of simulations.
  {
    const wide = P.makeDraws(postOf(F.posteriors1341), P.PLAN.N, P.seedOf(1790660521043, 9))
    const pacer = makePacer({ sliceMs: P.PLAN.sliceMs, yieldFn: async () => {} })
    const d = await pacer.slices(P.decideBladeRouteGen({ base: INPUTS, traj: P.trajectoryOf(BASIS), basis: BASIS, bladeStartAt: startAt(fresh, null), prev: null, draws: wide, redecide: true, budgetMs: 1e9, clock: pacer.cpuNow }), 'wide')
    const cyc = wide.map((x) => P.applyDraw(INPUTS, x).cycleHours)
    c3.examined(1)
    c3.note(`wide cadence posterior (${Math.min(...cyc).toFixed(2)}-${Math.max(...cyc).toFixed(2)}h): ${d.bladeSims} blade simulation(s), ${pacer.stats.cpuMs.toFixed(0)}ms of work, longest step ${pacer.stats.sections.wide.maxStepMs.toFixed(1)}ms`)
    if (!(d.bladeSims <= 8 * BB.BLADE_ENSEMBLE.Q)) c3.fail(`wide cadence posterior: ${d.bladeSims} blade simulations (the cadence steps are not collapsing: more than 8 steps x ${BB.BLADE_ENSEMBLE.Q} members)`)
    if (!(pacer.stats.sections.wide.maxStepMs < P.PLAN.sliceMs / 2)) c3.fail(`wide: a step held the page ${pacer.stats.sections.wide.maxStepMs}ms`)
  }

  const c4 = new Check('BR4', 'progress.js: the route through decideBladeRouteGen; the slot to bladeburner only on the committed route, in the division, with no body leg; the combat gym a body leg; plan.txt publishes it')
  checks.push(c4)
  const prog = fs.readFileSync(path.join(REPO_ROOT, 'progress.js'), 'utf8')
  const guards = [
    [/yield\* decideBladeRouteGen\(\{/, 'bladeRouteOf decides through plan.decideBladeRouteGen'],
    [/planDecide\(pc, 'bladeRoute'/, "the decision is recorded as decisions.bladeRoute (planDecide)"],
    [/if \(bladeOn && bladeJoined && !bodyStep && !graftStep\?\.running && canWork && !flags\.dry\) \{\s*workedFaction = null\s*slotOwner = 'bladeburner'/, "slot.owner 'bladeburner' only on the committed route, joined, no body leg, no running graft"],
    [/const bodyStepRaw = covenantStep \?\? bladeGymStep \?\?[\s\S]*const bodyStep = \(\(\) => \{\s*const st = bodyStepRaw/, 'the combat-100 gym is a body leg (priced by gymcredit GC4)'],
    [/bladeRoute: pc\.decisions\.bladeRoute \?\? pc\.prev\?\.decisions\?\.bladeRoute \?\? null/, 'plan.txt publishes decisions.bladeRoute (carried)'],
    [/br\?\.key === 'blade' && typeof br\.q50 === 'number' \? br :/, "the published exit is the Bladeburner route's when it is committed"],
    [/else if \(graftStep && \(graftStep\.running \|\| !bladeOn\)/, 'no NEW graft on the Bladeburner route'],
  ]
  for (const [re, what] of guards) {
    c4.examined(1)
    if (!re.test(prog)) c4.fail(`progress.js: ${what} — not found`)
  }
  const owners = [...prog.matchAll(/slotOwner = 'bladeburner'/g)].length
  c4.examined(1)
  if (owners !== 1) c4.fail(`slotOwner = 'bladeburner' appears ${owners} times (one guarded site)`)

  const c5 = new Check('BR5', 'the Bladeburner exit: endgame.js reads the black ops from the game first and leaves only through leave() (hold, --next); bladeburner.js never destroys')
  checks.push(c5)
  const eg = fs.readFileSync(path.join(REPO_ROOT, 'endgame.js'), 'utf8')
  const bbjs = fs.readFileSync(path.join(REPO_ROOT, 'bladeburner.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  const egCode = eg.replace(/\/\/.*$/gm, '')
  c5.examined(5)
  const iBlade = egCode.indexOf('ns.bladeburner.getNextBlackOp()')
  const iWD = egCode.indexOf('ns.getServerRequiredHackingLevel(WD)')
  if (!(iBlade > 0 && iWD > 0 && iBlade < iWD)) c5.fail('endgame.js must read getNextBlackOp() before resolving the World Daemon (which throws until The Red Pill)')
  if (!/if \(blade\?\.done\) \{[\s\S]{0,600}?await leave\(/.test(egCode)) c5.fail('the Bladeburner exit does not go through leave()')
  const leaveBody = egCode.slice(egCode.indexOf('async function leave('))
  if (!(leaveBody.indexOf("ns.read('/endgame-hold.txt')") > 0 && leaveBody.indexOf("ns.read('/endgame-hold.txt')") < leaveBody.indexOf('destroyW0r1dD43m0n('))) c5.fail('leave() must read /endgame-hold.txt before destroyW0r1dD43m0n')
  if ([...egCode.matchAll(/destroyW0r1dD43m0n\(/g)].length !== 1) c5.fail('endgame.js must call destroyW0r1dD43m0n exactly once (inside leave)')
  if (/ns\.singularity|destroyW0r1dD43m0n\s*\(/.test(bbjs)) c5.fail('bladeburner.js references destroyW0r1dD43m0n or ns.singularity — the daemon must never leave the node')
  return checks
}
