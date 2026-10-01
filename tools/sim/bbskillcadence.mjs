// SKILL-POINT CADENCE: the game's own classes (bbsim, the shared policy) and the
// exit model (bbplan.bladeExit) from a BN6 entry, five infiltrating sleeves, one
// row per cadence at which skill points are spent. NOT CALIBRATED against the
// live game (a policy comparison on the game's classes; the model's error vs
// them printed per row).
//
//   SEEDS=1,2,3 SE=60,600,3600 node tools/sim/bbskillcadence.mjs     (~7 min per seed per cadence)
//
// 2026-10-01, seed 1 (game / model hours to the 21st black op): every 60s
// 39.1 / 38.7, every 600s 34.3 / 37.2, hourly 28.1 / 32.5. The live daemon
// spent every minute while the exit model priced hourly batches; both now use
// POLICY.skillEveryS (3600). One seed: a direction, not a median — run more
// before tuning the number further. Model error printed beside the game's.
import '../test/gameresolve.mjs'
import { runBladeburner } from './nodechoice/bbsim.mjs'
import g, { setBitNode } from './nodechoice/game.mjs'
import { nodeMults, sfMults } from './nodechoice/hackexit.mjs'
const bp = await import('bbplan.js')
const SF = [[1, 3], [2, 1], [4, 2], [5, 1], [8, 1], [9, 1], [10, 1]]
const SEEDS = (process.env.SEEDS ?? '1,2,3').split(',').map(Number)
const gymRate = (() => {
  setBitNode(6, 1)
  g.initSourceFiles()
  const P = new g.PlayerObject()
  g.setPlayer(P)
  P.sourceFiles = new Map(SF)
  P.resetMultipliers()
  P.reapplyAllSourceFiles()
  const w = g.calculateClassEarnings(P, g.GymType.strength, g.LocationName.Sector12PowerhouseGym)
  return w.strExp * 5 * P.mults.strength_exp
})()
function modelStart(sleeves, extra) {
  const m6 = nodeMults(6)
  const sm = sfMults(SF)
  const mults = { ...sm }
  for (const s of ['strength', 'defense', 'dexterity', 'agility']) mults[s] = sm[s] * m6[`${s[0].toUpperCase()}${s.slice(1)}LevelMultiplier`]
  mults.charisma = sm.charisma * m6.CharismaLevelMultiplier
  return { person: { skills: { hacking: 300, strength: 1, defense: 1, dexterity: 1, agility: 1, charisma: 1, intelligence: 132 }, exp: {}, mults }, int: 132, joined: false, gymExpPerSec: gymRate, bnRank: m6.BladeburnerRank, skillCostMult: m6.BladeburnerSkillCost, sleeves, maxH: 600, dt: 300, ...extra }
}
const sleeves = JSON.parse(process.env.SL ?? '{"infiltrate":5,"support":0,"fa":0}')
for (const se of (process.env.SE ?? '600,3600').split(',').map(Number)) {
  const pol = { ...bp.POLICY, skillEveryS: se }
  const t0 = Date.now()
  const hs = SEEDS.map((seed) => runBladeburner({ node: 6, sf: SF, g: 0, installEveryH: null, intelligence: 132, hacking: 300, seed, maxH: 600, policy: { shared: true, sharedPolicy: pol, sleeves, gymTo: 100, useEst: false, skillEveryS: se } }).hours)
  const model = bp.bladeExit(modelStart(sleeves, { skillEveryS: se }), pol).hours
  console.log(`skill every ${se}s: game ${hs.map((h) => h?.toFixed(1)).join(' ')}  model ${model?.toFixed(1)}  (${((Date.now() - t0) / 1000).toFixed(0)}s)`)
}
