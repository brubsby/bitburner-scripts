// BN14.1 BLADEBURNER POLICY AUDIT — the game's own classes (bbsim) from the LIVE
// division state, one policy variant against the shipped policy, CRN-paired seeds.
//
//   node tools/sim/bb14.mjs [--fx fixture.json] [--seeds 1,2,3] [--maxH 80] [--only a,b] [--model]
//
// The start is the live state frozen by tools/sim/bb14/mkfix.py
// (tools/test/fixture-bn14-bbaudit.json): rank, skill points and levels,
// stamina, the six cities (TRUE populations where the daemon read them), the
// action counts and max levels, the team, the fleet (bladeRoute.sleeves) and
// the Go farm's Tetrads channel growing at its measured rate. Every outcome
// (rolls, rank, counts, chaos, events, casualties, sleeve work) is the game's
// (tools/sim/nodechoice/bbsim.mjs); only the DECISIONS differ between arms.
//
// CHECKS printed first (CLAUDE.md "calibrate or say so"): the solved level
// multipliers reproduce every live combat level; the shipped arm's first-hour
// rank rate against the daemon's measured rank/h.
//
// NOT SIMULATED, named: money (hospital bills, nothing bought — the exit is
// Bladeburner-bound with no install planned: installBasis 'never'); the
// sleeves' exp transfer to the player (shocked ~100, so ~0); the Go farm's
// other channels; an install.
import '../test/gameresolve.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from '../test/gameresolve.mjs'
import { runBladeburner } from './nodechoice/bbsim.mjs'
import g from './nodechoice/game.mjs'

const bp = await import('bbplan.js')
const GP = await import('goplan.js')

const argv = process.argv.slice(2)
const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d)
export const FX_PATH = path.join(REPO_ROOT, 'tools/test/fixture-bn14-bbaudit.json')

const COMBAT = ['strength', 'defense', 'dexterity', 'agility']
const LV = { hacking: 'Hacking', strength: 'Strength', defense: 'Defense', dexterity: 'Dexterity', agility: 'Agility', charisma: 'Charisma' }
const f32 = (exp) => 32 * Math.log(exp + 534.6) - 200

/** The player's LEVEL multipliers solved from (level, exp): the middle of the interval floor() leaves. */
export function solvedMults(fx, nodeMults) {
  const out = {}
  for (const [s, cap] of Object.entries(LV)) {
    const lv = fx.person.skills[s]
    const f = f32(fx.person.exp[s] ?? 0)
    out[s] = (lv + 0.5) / f / nodeMults[`${cap}LevelMultiplier`]
  }
  return out
}

/** The Go farm's Tetrads channel: effect now, nodes behind it, and the measured regrowth per hour (plan bladeRoute.start.goCombat). */
export function goOf(fx) {
  const gc = fx.bladeRoute?.start?.goCombat ?? {}
  const pct = fx.go?.bonuses?.Tetrads
  const goPower = fx.go?.goPower ?? gc.goPower ?? 1
  const sf14 = fx.go?.sf14 ?? 0
  const effect = Number.isFinite(pct) ? 1 + pct / 100 : gc.effect
  const nodes = Number.isFinite(pct) ? GP.nodePowerFromBonus(pct, GP.OPPONENTS.Tetrads.power, goPower, sf14) : gc.nodes
  return { effect, nodes, perHour: gc.perHour ?? 0, power: GP.OPPONENTS.Tetrads.power, goPower, sf14 }
}

/**
 * One run from the live state. arm: { sharedPolicy (POLICY overrides), choose, planSkills,
 * teamOps, fleet {infiltrate, support, fa}, goGrowth (false: the effect frozen) }.
 */
export function runFrom(fx, arm = {}, { seed = 1, maxH = 80 } = {}) {
  const tel = fx.tel
  const fleet = arm.fleet ?? fx.bladeRoute.sleeves ?? { infiltrate: 0, support: 0, fa: 0 }
  const go = goOf(fx)
  const boAt = []
  let check = null
  let goPrev = go.effect
  let goNext = 0
  const setup = ({ g: G, P, bb }) => {
    const nm = G.currentNodeMults
    for (const [k, v] of Object.entries(fx.person.expMults)) P.mults[k] = v
    Object.assign(P.mults, solvedMults(fx, nm))
    P.exp = { ...P.exp, ...fx.person.exp }
    P.updateSkillLevels()
    P.skills.intelligence = fx.person.skills.intelligence
    P.hp.current = P.hp.max
    check = Object.fromEntries(Object.keys(LV).map((s) => [s, { sim: P.skills[s], live: fx.person.skills[s] }]))
    bb.rank = tel.rank
    bb.maxRank = tel.rank
    bb.totalSkillPoints = Math.floor(tel.rank / G.BladeburnerConstants.RanksPerSkillPoint)
    bb.skillPoints = tel.skillPoints
    for (const [name, lvl] of Object.entries(tel.levels ?? {})) if (lvl > 0) bb.setSkillLevel(name, lvl)
    bb.staminaBonus = tel.staminaBonus ?? 0
    for (const c of tel.cities) {
      const city = bb.cities[c.name]
      city.popEst = c.popEst
      city.pop = Number.isFinite(c.pop) && c.pop >= 0 ? c.pop : c.popEst
      city.chaos = c.chaos
      city.comms = c.comms
    }
    bb.city = tel.city
    for (const a of [...Object.values(bb.contracts), ...Object.values(bb.operations)]) {
      a.count = tel.counts[a.name]
      a.maxLevel = tel.maxLevels[a.name]
      a.level = a.maxLevel
      const d = bp.dataOf(a.name)
      a.successes = a.maxLevel > 1 ? bp.successesNeeded(a.maxLevel - 1, bp.perLevelOf(d)) : 0
    }
    bb.numBlackOpsComplete = tel.blackOps.done
    // The team: humans = the live team less the supporting sleeves (SleeveSupportWork adds each one).
    const liveSup = fx.bladeRoute.sleeves?.support ?? 0
    bb.teamSize = Math.max(0, tel.team - liveSup) + (arm.extraHumans ?? 0)
    fx.sleeves.forEach((x, i) => {
      const s = new G.Sleeve()
      s.memory = 100
      s.shock = x.shock
      s.sync = x.sync
      s.exp = { ...s.exp, ...x.exp }
      s.updateSkillLevels()
      P.sleeves.push(s)
      const w =
        i < fleet.infiltrate
          ? new G.SleeveInfiltrateWork()
          : i < fleet.infiltrate + fleet.support
            ? new G.SleeveSupportWork()
            : i < fleet.infiltrate + fleet.support + (fleet.fa ?? 0)
              ? new G.SleeveBladeburnerWork({ actionId: { type: G.BladeburnerActionType.General, name: G.BladeburnerGeneralActionName.FieldAnalysis } })
              : null
      if (w) s.startWork(w)
    })
    bb.calculateMaxStamina()
    bb.stamina = Math.min(bb.maxStamina, tel.stamina)
    arm.setup?.({ g: G, P, bb })
  }
  const perTick = ({ t, P }) => {
    if (arm.goGrowth === false || !(go.perHour > 0) || t < goNext) return
    goNext = t + 60
    const e = GP.effectAt(go.nodes + (go.perHour * t) / 3600, go.power, go.goPower, go.sf14)
    for (const c of COMBAT) P.mults[c] *= e / goPrev
    goPrev = e
    P.updateSkillLevels()
  }
  let lastBo = tel.blackOps.done
  const rankAt = []
  const onStep = ({ t, bb }) => {
    if (bb.numBlackOpsComplete !== lastBo) {
      lastBo = bb.numBlackOpsComplete
      boAt.push(+(t / 3600).toFixed(2))
    }
    if (t % 3600 < 3) rankAt.push(Math.round(bb.rank))
    arm.onStep?.({ t, bb })
  }
  const r = runBladeburner({
    node: 14, level: 1, sf: fx.person.sourceFiles, g: 0, installEveryH: null, intelligence: fx.person.skills.intelligence, hacking: 1, seed, maxH, gymFirst: arm.gymFirst,
    setup, perTick, onStep,
    policy: { shared: true, sharedPolicy: { ...bp.POLICY, ...(arm.sharedPolicy ?? {}) }, sleeves: {}, gymTo: arm.gymTo ?? 100, useEst: false, choose: arm.choose, planSkills: arm.planSkills, teamOps: arm.teamOps, skillEveryS: arm.skillEveryS },
  })
  return { ...r, boAt, rankAt, check }
}

// --- the model on the same start (bbplan.bladeStartOf -> bladeExit), formula k = 1 ---
export function modelStartOf(fx, { pol = bp.POLICY, sleeves = null } = {}) {
  const nm = g.getBitNodeMultipliers(14, 1)
  const sm = solvedMults(fx, nm)
  const mults = { ...fx.person.expMults }
  for (const [s, cap] of Object.entries(LV)) mults[s] = sm[s] * nm[`${cap}LevelMultiplier`]
  const person = { skills: { ...fx.person.skills }, exp: { ...fx.person.exp }, mults }
  const go = goOf(fx)
  return bp.bladeStartOf({ tel: fx.tel, person, sleeves: sleeves ?? fx.bladeRoute.sleeves, gymExpPerSec: fx.bladeRoute.start?.gymExpPerSec, bnRank: nm.BladeburnerRank, skillCostMult: nm.BladeburnerSkillCost, goCombat: go, now: Date.parse(fx.at), maxH: 200 })
}

export const loadFx = (p = FX_PATH) => JSON.parse(fs.readFileSync(p, 'utf8'))

if (/tools\/sim\/bb14\.mjs$/.test(process.argv[1] ?? '')) {
  const fx = loadFx(arg('--fx', FX_PATH))
  const seeds = arg('--seeds', '1').split(',').map(Number)
  const maxH = Number(arg('--maxH', 80))
  console.log(`BN14.1 from ${fx.at}: rank ${fx.tel.rank} (${fx.tel.rankPerHour}/h live), black ops ${fx.tel.blackOps.done}/21, team ${fx.tel.team}, fleet ${JSON.stringify(fx.bladeRoute.sleeves)}; plan's exit ${fx.bladeRoute.bladeH}h`)
  if (argv.includes('--model')) {
    const s0 = modelStartOf(fx)
    const t0 = Date.now()
    const m = bp.bladeExit(s0)
    console.log(`model (k=1): ${m.hours?.toFixed(2)}h  (${Date.now() - t0}ms)`)
  }
  for (const seed of seeds) {
    const t0 = Date.now()
    const r = runFrom(fx, {}, { seed, maxH })
    console.log(`seed ${seed}: ${r.hours?.toFixed(2) ?? '-'}h  rank ${Math.round(r.rank)} bo ${r.blackOps}  boAt ${r.boAt.join(' ')}  ${((Date.now() - t0) / 1000).toFixed(0)}s`)
    console.log('  levels check', JSON.stringify(r.check))
    console.log('  rank by hour', r.rankAt.slice(0, 12).join(' '))
    console.log('  skills', JSON.stringify(r.skills))
  }
  process.exit(0)
}
