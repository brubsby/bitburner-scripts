// INSTALL NOW vs NEVER on the BN14.1 Bladeburner exit, from the live state —
// the model (bbplan.bladeExit, the plan's own pricing) and the game's classes
// (bbsim, CRN-paired seeds), on the batch the purchase step would buy now
// (/tel/installgate.txt plan.buy) and on that batch plus extra NeuroFlux levels.
//
//   node --max-old-space-size=1024 tools/sim/bb14/installnow.mjs [--fx fx.json] [--seeds 1,2,3] [--nfg 0,10,30] [--maxH 40]
//
// The fixture: python3 tools/sim/bb14/mkfix.py fx.json (the live division,
// player, fleet and Go farm). The install arm in bbsim is the game's
// prestigeAugmentation as the Bladeburner route meets it: every combat and
// charisma exp to 0, the batch's level/exp/bladeburner multipliers applied,
// the Go farm's Tetrads effect zeroed (Go/Go.ts:34-47) and regrown at the
// measured rate, the retrain at the gym (bbsim gymFirst), rank, skills and
// black ops kept (Prestige.ts:152-155). NOT SIMULATED, named: money (the
// retrain's gym fees on $1262 — optimistic for the install), Simulacrum.
// --keepGo is a counterfactual (the install keeping the Go effect), for attribution only.
//
// CALIBRATION: the model's 'never' is printed beside the plan's published
// bladeH (the plan applies the rank k posterior, this runs k = 1), and bbsim's
// 'never' beside both. No live install on this route has been replayed in
// bbsim; the model's install arm was replayed against the 10:22Z install
// (tools/sim/exitjump/replay-bn14-1022.mjs).
//
// RESULT 2026-10-05 02:25Z (rank 62.1k, 6/21 black ops, Go x3.95, the
// $11.45T 22-augmentation batch incl. every Bladeburners augmentation + 4 NFG):
//   model never 6.35h, install now +1.23h (+5 more NFG +0.97h; +40 NFG -0.23h)
//   bbsim 10 paired seeds: never 5.99-6.27h, install now +0.60..+1.11h (mean +0.86h),
//   +5 NFG +0.59..+0.96h; --keepGo (no Go wipe) -0.12..-0.27h — the Go wipe is ~1.05h.
import '../../test/gameresolve.mjs'
import fs from 'node:fs'
import { loadFx, runFrom, goOf, solvedMults, FX_PATH } from '../bb14.mjs'
import g from '../nodechoice/game.mjs'

const bp = await import('bbplan.js')
const { drain } = await import('coop.js')
const argv = process.argv.slice(2)
const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d)
const T = process.env.HOME + '/Repos/bitburner-scripts/.telemetry/'
const fx = loadFx(arg('--fx', FX_PATH))
const seeds = arg('--seeds', '1,2,3').split(',').map(Number)
const nfgs = arg('--nfg', '0').split(',').map(Number)
const maxH = Number(arg('--maxH', 40))
// --keepGo: a COUNTERFACTUAL attribution arm (not the game): the install keeps the Go effect — how much of the loss is the Go wipe.
const keepGo = argv.includes('--keepGo')
const stats = JSON.parse(fs.readFileSync(T + 'snap-augstats.txt', 'utf8')).data.stats
const gate = JSON.parse(fs.readFileSync(T + 'installgate.txt', 'utf8'))
const batch = gate.plan.buy.map((b) => b.name)
const COMBAT = ['strength', 'defense', 'dexterity', 'agility']

const contentOf = (extraNfg) => bp.bladeContentOf([...batch, ...Array(extraNfg).fill('NeuroFlux Governor')], (n) => stats[n])
const go = goOf(fx)
console.log(`live ${fx.at}: rank ${fx.tel.rank}, black ops ${fx.tel.blackOps.done}/21, Go Tetrads x${go.effect.toFixed(3)} (n ${Math.round(go.nodes)}, +${go.perHour}/h); batch ${batch.length} ($${(gate.plan.totalCost / 1e12).toFixed(2)}T)`)

// --- the model (the plan's pricing; members' mean as the plan does) ---
const meanH = (s) => drain(bp.bladeExitMeanGen(s)).hours

// modelStartOf's inputs with an install (the same builder the plan calls).
const LV = { hacking: 'Hacking', strength: 'Strength', defense: 'Defense', dexterity: 'Dexterity', agility: 'Agility', charisma: 'Charisma' }
function modelInstall(gains) {
  const nm = g.getBitNodeMultipliers(14, 1)
  const sm = solvedMults(fx, nm)
  const mults = { ...fx.person.expMults }
  for (const [s, cap] of Object.entries(LV)) mults[s] = sm[s] * nm[`${cap}LevelMultiplier`]
  const person = { skills: { ...fx.person.skills }, exp: { ...fx.person.exp }, mults }
  return bp.bladeStartOf({ tel: fx.tel, person, sleeves: fx.bladeRoute.sleeves, gymExpPerSec: fx.bladeRoute.start?.gymExpPerSec, bnRank: nm.BladeburnerRank, skillCostMult: nm.BladeburnerSkillCost, goCombat: go, now: Date.parse(fx.at), maxH: 200, install: gains ? { firstH: 0, gains, simulacrum: false } : null })
}
const neverM2 = meanH(modelInstall(null))
console.log(`MODEL never ${neverM2.toFixed(2)}h  (plan published ${fx.bladeRoute.bladeH}h)`)
for (const k of nfgs) {
  const c = contentOf(k)
  const h = meanH(modelInstall(c.gains))
  console.log(`MODEL install now, batch + ${k} NFG: ${h.toFixed(2)}h (${(h - neverM2 >= 0 ? '+' : '') + (h - neverM2).toFixed(2)}h)  gains ${JSON.stringify(c.gains)}`)
}

// --- bbsim, paired seeds ---
const installArm = (gains) => ({
  gymFirst: true,
  setup: ({ P, bb }) => {
    for (const s of COMBAT) P.mults[s] = (P.mults[s] / (keepGo ? 1 : go.effect)) * (gains[s] ?? 1)
    P.mults.charisma *= gains.charisma ?? 1
    for (const k of ['strength_exp', 'defense_exp', 'dexterity_exp', 'agility_exp', 'charisma_exp', 'bladeburner_success_chance', 'bladeburner_max_stamina', 'bladeburner_stamina_gain']) if (gains[k]) P.mults[k] = (P.mults[k] ?? 1) * gains[k]
    for (const s of [...COMBAT, 'charisma']) P.exp[s] = 0
    P.updateSkillLevels()
    P.hp.current = P.hp.max
    bb.resetAction?.()
    bb.calculateMaxStamina()
    bb.stamina = Math.min(bb.stamina, bb.maxStamina)
  },
})
// The install arm's Go starts from 0 nodes: runFrom's perTick grows from fx's nodes, so give it a fixture with Tetrads at 0.
const fxI = { ...fx, go: { ...fx.go, bonuses: { ...fx.go.bonuses, Tetrads: 0 } }, bladeRoute: { ...fx.bladeRoute, start: { ...fx.bladeRoute.start, goCombat: { ...fx.bladeRoute.start.goCombat, effect: 1 } } } }
for (const seed of seeds) {
  const t0 = Date.now()
  const n = runFrom(fx, {}, { seed, maxH })
  const row = [`seed ${seed}: never ${n.hours?.toFixed(2) ?? '-'}h`]
  for (const k of nfgs) {
    const c = contentOf(k)
    const r = runFrom(keepGo ? fx : fxI, installArm(c.gains), { seed, maxH })
    row.push(`install+${k}NFG ${r.hours?.toFixed(2) ?? '-'}h (${r.hours && n.hours ? ((r.hours - n.hours >= 0 ? '+' : '') + (r.hours - n.hours).toFixed(2)) : '?'})`)
  }
  console.log(row.join('  '), `${((Date.now() - t0) / 1000).toFixed(0)}s`)
}
process.exit(0)
