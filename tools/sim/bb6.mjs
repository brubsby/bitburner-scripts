// BITNODE 6 BY ROUTE: the Bladeburner exit (21 black ops -> endgame.js) vs the
// hacking exit (w0r1d_d43m0n at 3000 x WorldDaemonDifficulty 2), for the stack
// we arrive with — and the in-game exit model checked against the game.
//
//   TELEMETRY=~/Repos/bitburner-scripts/.telemetry node tools/sim/bb6.mjs [--seeds 9] [--quick]
//
// ---------------------------------------------------------------------------
// NOT CALIBRATED against a live game, and it cannot be yet: no node of this
// playthrough has had Bladeburner. What IS checked, and printed first:
//   (1) bbplan.bladeExit — the expected-value model the plan prices the route
//       with, in-game — against tools/sim/nodechoice/bbsim.mjs, the GAME's own
//       Bladeburner/Sleeve/Player classes running the SAME policy
//       (bbplan.chooseAction / planSkills / bestCity, pol.shared). Same start,
//       same sleeves, same installs. The error is printed per scenario.
//   (2) the formulas themselves: npm test -- bbplan (BB1..BB9).
// BN6 is the calibration: the daemon publishes the quantities the game shows
// (rank, rank/h, black-op chances, action times) beside what these models
// predicted, and tools/healthcheck.mjs section F fails when rank stops moving.
//
// FIXED INPUTS, stated (each with its direction):
//   - money never binds (gym fees, hospital bills, augmentations): optimistic;
//   - the join comes after the gym from a fresh entry with money in hand: the
//     real opening must first afford the gym — optimistic by the hours the
//     opening takes (the hacking route pays the same opening);
//   - the player's hacking is a fixed 300 (weighs <= 0.25 of competence at
//     decay 0.6-0.85): either way;
//   - combat multiplier: pessimistic bound g_combat = 0 (no combat augs at
//     all; installs only reset exp), optimistic bound = the node's hacking g
//     spent on combat at the measured install cadence (one economy).
// ---------------------------------------------------------------------------

import '../test/gameresolve.mjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runBladeburner } from './nodechoice/bbsim.mjs'
import g, { setBitNode } from './nodechoice/game.mjs'
import { nodeSegments } from './nodechoice/measure.mjs'
import { hackExitHours, backOutG, defaultProfile, nodeMults, sfMults } from './nodechoice/hackexit.mjs'

const bp = await import('bbplan.js')
const arg = (k, d) => {
  const i = process.argv.indexOf(k)
  return i > -1 ? process.argv[i + 1] : d
}
const SEEDS = Number(arg('--seeds', 9))
const QUICK = process.argv.includes('--quick')
const f1 = (x) => (x === null || x === undefined || !isFinite(x) ? '    -' : x.toFixed(1).padStart(6))
const pct = (x) => (x === null || !isFinite(x) ? '   -' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(0)}%`.padStart(5))
const median = (xs) => {
  const v = xs.filter((x) => x !== null && isFinite(x)).sort((a, b) => a - b)
  if (!v.length) return null
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}
const gm = (xs) => Math.exp(xs.reduce((s, x) => s + Math.log(x), 0) / xs.length)

// The stack we enter BN6 with (after BN9.1).
const SF = [[1, 3], [2, 1], [4, 2], [5, 1], [8, 1], [9, 1], [10, 1]]
const SLEEVES = 5 // sleeve.txt 2026-10-01: 5 (SF10.1 + 4 Covenant), reset to shock 100 / exp 0 at the node
const HACKING = 300

// ---------------------------------------------------------------------------
// The economy latent g, measured as nextnode.mjs does (one line per node).
// ---------------------------------------------------------------------------
const segs = (await nodeSegments()).filter((s) => s.hours >= 1)
const seg = (bn, i = -1) => {
  const all = segs.filter((s) => s.bitNode === bn)
  return i < 0 ? all[all.length + i] : all[i]
}
const CURRENT = [seg(2), seg(4, -1), seg(10), seg(8), seg(1, -1), seg(9)].filter(Boolean)
const profile = defaultProfile({ cycleHours: median(CURRENT.map((s) => s.meanLifeH)), expRich: seg(10)?.expRateEnd ?? undefined, expPoor: seg(8)?.expRateEnd ?? undefined })
const intelligence = segs[segs.length - 1]?.intelligence ?? 0
const AMC = (n) => nodeMults(n).AugmentationMoneyCost
const meas = CURRENT.map((s) => ({ bn: s.bitNode, g: backOutG({ node: s.bitNode, sf: s.sfOnEntry, profile }, s.hours).g })).filter((x) => x.g)
const amc1 = meas.filter((c) => AMC(c.bn) === 1)
const other = meas.filter((c) => AMC(c.bn) !== 1)
const GAMMA = other.length && amc1.length ? other.map((c) => Math.log(gm(amc1.map((x) => x.g)) / c.g) / Math.log(AMC(c.bn))).reduce((a, b) => a + b, 0) / other.length : 0
const norms = meas.map((c) => c.g * Math.pow(AMC(c.bn), GAMMA))
const G = { lo: Math.min(...norms), mid: gm(norms), hi: Math.max(...norms) }
const g6 = (sc) => G[sc] * Math.pow(AMC(6), -GAMMA)
const every = +profile.cycleHours.toFixed(2)

console.log('='.repeat(100))
console.log('BITNODE 6 BY ROUTE — stack SF' + SF.map(([n, l]) => `${n}.${l}`).join(' SF') + `, ${SLEEVES} sleeves, int ${intelligence}`)
console.log('='.repeat(100))
console.log(`economy latent g (ln hacking mult per hour, AMC-normalised): lo ${G.lo.toFixed(4)} mid ${G.mid.toFixed(4)} hi ${G.hi.toFixed(4)}; install cadence ${every}h (median measured life)`)

// ---------------------------------------------------------------------------
// The game-physics run (bbsim, shared policy) and the in-game model on the SAME start.
// ---------------------------------------------------------------------------
const gymRate = (() => {
  setBitNode(6, 1)
  g.initSourceFiles()
  const P = new g.PlayerObject()
  g.setPlayer(P)
  P.sourceFiles = new Map(SF)
  P.resetMultipliers()
  P.reapplyAllSourceFiles()
  const w = g.calculateClassEarnings(P, g.GymType.strength, g.LocationName.Sector12PowerhouseGym)
  return w.strExp * 5 * P.mults.strength_exp // per second, after the exp multiplier (gainStats)
})()
function modelStart(cfg) {
  const m6 = nodeMults(6)
  const sm = sfMults(SF)
  const mults = { ...sm }
  for (const s of ['strength', 'defense', 'dexterity', 'agility']) mults[s] = sm[s] * m6[`${s[0].toUpperCase()}${s.slice(1)}LevelMultiplier`]
  mults.charisma = sm.charisma * m6.CharismaLevelMultiplier
  return {
    person: { skills: { hacking: HACKING, strength: 1, defense: 1, dexterity: 1, agility: 1, charisma: 1, intelligence }, exp: {}, mults },
    int: intelligence,
    joined: false,
    gymExpPerSec: gymRate,
    bnRank: m6.BladeburnerRank,
    skillCostMult: m6.BladeburnerSkillCost,
    pop: 1.25e9, // City.ts: uniform 1e9..1.5e9 at creation
    sleeves: cfg.sleeves,
    install: cfg.every ? { everyH: cfg.every, combatGain: Math.exp(cfg.g * cfg.every) } : null,
    maxH: 600,
    dt: 300,
  }
}
function simRuns(cfg, pol, seeds) {
  const out = []
  for (const seed of seeds) {
    const r = runBladeburner({
      node: 6, sf: SF, g: cfg.g, installEveryH: cfg.every, intelligence, hacking: HACKING, seed, maxH: 600,
      policy: { shared: true, sharedPolicy: pol, sleeves: cfg.sleeves, gymTo: 100, useEst: false },
    })
    out.push(r.hours)
  }
  return out
}

const CONFIGS = [
  { key: 'pess', label: 'pessimistic: no combat augs (g=0), no installs', g: 0, every: null },
  { key: 'pess-inst', label: `pessimistic + installs every ${every}h (exp resets, g=0)`, g: 0, every },
  { key: 'opt-mid', label: `optimistic mid: combat g ${g6('mid').toFixed(3)}/h, installs every ${every}h`, g: g6('mid'), every },
  { key: 'opt-hi', label: `optimistic hi: combat g ${g6('hi').toFixed(3)}/h, installs every ${every}h`, g: g6('hi'), every },
]

// Policy search on 3 seeds (the shared policy's two thresholds), one config.
const SEL = [101, 102, 103]
const GRID = QUICK ? [{ minP: bp.POLICY.minP, blackThr: bp.POLICY.blackThr }] : [0.3, 0.4, 0.5, 0.7].flatMap((minP) => [0.7, 0.8, 0.9, 0.97].map((blackThr) => ({ minP, blackThr })))
const base = { ...CONFIGS[0], sleeves: { infiltrate: SLEEVES, support: 0, fa: 0 } }
let bestPol = null
for (const p of GRID) {
  const pol = { ...bp.POLICY, ...p }
  const hs = simRuns(base, pol, SEL)
  const m = hs.some((h) => h === null) ? Infinity : hs.reduce((a, b) => a + b, 0) / hs.length
  if (!bestPol || m < bestPol.m) bestPol = { p, pol, m }
  if (!QUICK) console.log(`  policy minP ${p.minP} blackThr ${p.blackThr}: ${isFinite(m) ? m.toFixed(1) + 'h' : 'unfinished'} (3 seeds)`)
}
console.log(`\nPOLICY (shared; chosen on 3 seeds, pessimistic config): minP ${bestPol.p.minP} blackThr ${bestPol.p.blackThr} -> ${bestPol.m.toFixed(1)}h mean; bbplan.POLICY ships minP ${bp.POLICY.minP} blackThr ${bp.POLICY.blackThr}`)
const POL = bestPol.pol

// Sleeve configurations: the model picks (chooseSleeveConfig); the game physics checks the pick against all-infiltrate.
console.log('\nSLEEVES — the model\'s choice (bbplan.chooseSleeveConfig) and the game physics on it')
const pickS = bp.chooseSleeveConfig(modelStart(base), SLEEVES, POL)
for (const x of pickS.byConfig.sort((a, b) => (a.hours ?? 1e9) - (b.hours ?? 1e9)).slice(0, 6)) console.log(`  model ${f1(x.hours)}h  infiltrate ${x.config.infiltrate} support ${x.config.support} field-analysis ${x.config.fa}`)
const physPick = median(simRuns({ ...base, sleeves: pickS.config }, POL, SEL))
const physAll = median(simRuns(base, POL, SEL))
console.log(`  game physics: model's pick ${f1(physPick)}h vs all-infiltrate ${f1(physAll)}h (3 seeds)`)
const SLV = physPick !== null && (physAll === null || physPick <= physAll) ? pickS.config : base.sleeves

console.log(`\nCALIBRATION of the in-game model (bbplan.bladeExit) against the game's classes (bbsim, same policy, ${SEEDS} seeds)`)
console.log('-'.repeat(100))
console.log('config                                                   game median [IQR]        model     model error')
const rows = []
for (const c of CONFIGS) {
  const cfg = { ...c, sleeves: SLV }
  const hs = simRuns(cfg, POL, Array.from({ length: SEEDS }, (_, i) => i + 1))
  const ok = hs.filter((h) => h !== null).sort((a, b) => a - b)
  const med = ok.length > SEEDS / 2 ? median(ok) : null
  const model = bp.bladeExit(modelStart(cfg), POL)
  const err = med && model.hours ? model.hours / med - 1 : null
  rows.push({ c, med, q1: ok[Math.floor(ok.length / 4)], q3: ok[Math.floor((3 * ok.length) / 4)], model: model.hours, err, failed: SEEDS - ok.length })
  console.log(`${c.label.padEnd(56)} ${f1(med)} [${f1(ok[Math.floor(ok.length / 4)])},${f1(ok[Math.floor((3 * ok.length) / 4)])}]  ${f1(model.hours)}   ${pct(err)}${SEEDS - ok.length ? `  (${SEEDS - ok.length} seeds unfinished in 600h)` : ''}`)
}
const worst = Math.max(...rows.map((r) => Math.abs(r.err ?? Infinity)))
console.log(`model vs game physics: worst |error| ${isFinite(worst) ? (worst * 100).toFixed(0) + '%' : 'n/a'} — the plan's route decision needs the two routes apart by more than this`)

// ---------------------------------------------------------------------------
// The hacking route, the same economy scenarios (exitplan.bestExitPolicy from a fresh entry).
// ---------------------------------------------------------------------------
console.log('\nBN6 EXIT BY ROUTE (hours from entry; SIMULATED, none measured)')
console.log('-'.repeat(100))
console.log('economy   hacking (World Daemon 6000)   Bladeburner pess (g=0)   Bladeburner opt (g on combat)   faster: pess bound / opt bound')
for (const sc of ['lo', 'mid', 'hi']) {
  const h = hackExitHours({ node: 6, sf: SF, profile, g: g6(sc) }).hours
  const pess = rows.find((r) => r.c.key === 'pess-inst')?.med
  const optCfg = { key: `opt-${sc}`, g: g6(sc), every, sleeves: SLV }
  const opt = sc === 'mid' ? rows.find((r) => r.c.key === 'opt-mid')?.med : sc === 'hi' ? rows.find((r) => r.c.key === 'opt-hi')?.med : median(simRuns(optCfg, POL, Array.from({ length: SEEDS }, (_, i) => i + 1)))
  const faster = (b) => (b === null || !isFinite(b) ? 'hacking' : h === null || !isFinite(h) || b < h ? 'Bladeburner' : 'hacking')
  console.log(`${sc.padEnd(9)} ${f1(h)}h                       ${f1(pess)}h                   ${f1(opt)}h                         ${faster(pess)} / ${faster(opt)}`)
}
console.log('\nNOT MODELLED (directions): money never binds in the Bladeburner runs (optimistic); the opening before the gym is affordable (optimistic, both routes pay it);')
console.log('the model takes random events and city dynamics in expectation (the game physics rolls them); sleeve exp transfer to the player (model pessimistic);')
console.log('the hacking exit still progressing on the Bladeburner route (the plan\'s blade arm is the black ops alone: pessimistic for Bladeburner).')
process.exit(0)
