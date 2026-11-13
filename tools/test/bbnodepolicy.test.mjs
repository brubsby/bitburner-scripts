// [NP] THE BLADEBURNER POLICY PER NODE (bbnodepolicy.js): BN15's bootstrap phase is off, and every player
// of the policy — bladeburner.js, bb-lite's actors, progress.js's exit model, the gameplan's bbsim specs —
// plays and prices the same one.
//
// bbboot.mjs --levers --cells BN15.1 (2026-10-25, 16 paired seeds in the game's classes): the bootstrap
// policy (bootMinP 0.15, Raid 0.25, skills every 120s until the first black op's rank 2.5k) costs
// +20.43 +- 5.02h on BN15's exit at BladeburnerRank 0.2 (it is -0.4..-0.7h at BN5.2/BN2.2).
//
//   NP1  nodePolicyOf: BN15 drops the bootstrap fields (phasePolicyOf then never boots), every other node
//        keeps POLICY itself; the lean policy too; the exit model's override
//   NP2  the wiring: bladeburner.js, bb-lite.js (+ its actors' node), progress.js's startFor, surrogate bbSpec
import './gameresolve.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { Check } from './harness.mjs'
import { REPO_ROOT } from './gameresolve.mjs'

const NP = await import('bbnodepolicy.js')
const BP = await import('bbplan.js')
const BL = await import('bbliteplan.js')

export async function run() {
  const out = []
  const c1 = new Check('NP1', "BN15 plays the black ops without the bootstrap phase; every other node plays POLICY unchanged")
  {
    const p15 = NP.nodePolicyOf(15)
    const view = { blackOp: { d: { n: 0 } }, rank: 10 } // booting under POLICY: no black op, rank under 2.5k
    c1.examined(7)
    if (!(p15.bootMinP === null && p15.bootRaidMinP === null && p15.bootSkillEveryS === null)) c1.fail('BN15: the bootstrap fields must be off', JSON.stringify({ bootMinP: p15.bootMinP, raid: p15.bootRaidMinP, every: p15.bootSkillEveryS }))
    if (BP.phasePolicyOf(view, p15) !== p15 || BP.phasePolicyOf(view, BP.POLICY).booting !== true) c1.fail('phasePolicyOf: POLICY boots at rank 10 with no black op, the BN15 policy does not')
    if (BP.skillEveryOf(p15, 0, 10) !== BP.POLICY.skillEveryS) c1.fail("BN15's skill cadence is POLICY.skillEveryS from the start (no 120s boot cadence)", BP.skillEveryOf(p15, 0, 10))
    if (NP.nodePolicyOf(5) !== BP.POLICY || NP.nodePolicyOf(13) !== BP.POLICY) c1.fail('every unlisted node plays POLICY itself (the gameplan surrogate keys stay unchanged)')
    if (NP.nodePolicyOf(15) !== p15) c1.fail('one object per policy and node (phasePolicyOf memoizes on it)')
    const lite = BL.litePolicyOf(15)
    if (!(lite.pinTop === true && lite.bootMinP === null) || BL.litePolicyOf(null) !== BL.LITE_POLICY || BL.litePolicyOf(6) !== BL.LITE_POLICY) c1.fail("the lean policy: BN15's keeps pinTop and drops the boot; unknown or unlisted nodes keep LITE_POLICY")
    const o = NP.nodePolicyOverrideOf(15)
    if (!(o && o.bootMinP === null) || NP.nodePolicyOverrideOf(2) !== null) c1.fail("the exit model's override (bladeStartOf policy): BN15 only", JSON.stringify(o))
  }
  out.push(c1)

  const c2 = new Check('NP2', 'the wiring: the daemon, bb-lite and its actors, the exit model and the gameplan play the node policy')
  {
    const rd = (f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8')
    const want = [
      ['bladeburner.js', /const POL = nodePolicyOf\(info\.currentNode, POLICY\)/, 'bladeburner.js resolves the node policy'],
      ['bladeburner.js', /let pick = chooseAction\(v, POL\)/, 'bladeburner.js chooses on it'],
      ['bladeburner.js', /planSkills\(v, sp, POL, costMult, POL\.skillChunks\)/, 'bladeburner.js spends skill points on it'],
      ['bladeburner.js', /skillEveryOf\(POL, boDone, rank\)/, "bladeburner.js's skill cadence is its"],
      ['bb-lite.js', /skillEveryOf\(nodePolicyOf\(info\.currentNode, POLICY\)/, "bb-lite.js's skill cadence is the node's"],
      ['bb-lite.js', /ownedAugs, node: info\.currentNode \}/, 'bb-lite.js hands bb-lite-act.js the node'],
      ['bb-lite.js', /costMult, node: info\.currentNode \}/, 'bb-lite.js hands bb-lite-skill.js the node'],
      ['bb-lite-act.js', /leanPick\(view, Number\.isInteger\(want\.node\) \? want\.node : null\)/, 'bb-lite-act.js picks on the node policy'],
      ['bb-lite-skill.js', /const pol = litePolicyOf\(Number\.isInteger\(want\.node\)/, 'bb-lite-skill.js plans on the node policy'],
      ['progress.js', /goCombat, policy: nodePolicyOverrideOf\(info\.currentNode\) \}\)/, "progress.js's exit model prices the node policy (startFor)"],
      ['tools/sim/gameplan/surrogate.mjs', /sharedPolicy: nodePolicyOf\(n, bbPolicy\)/, "the gameplan's bbsim plays the node policy"],
    ]
    for (const [f, re, what] of want) {
      c2.examined(1)
      if (!re.test(rd(f))) c2.fail(`${what} — not found in ${f}`)
    }
  }
  out.push(c2)

  // NP3 BN12 boots its Raids at the boot's own bar (tools/sim/bb12.mjs, 8 cells x 24 paired seeds: clear
  // -0.05 +- 0.01h, first black op -0.12 +- 0.02h); the exit model keeps pricing those Raids at minP
  const c3 = new Check('NP3', "BN12: the boot's Raid bar is bootMinP (0.15), for the daemon and bb-lite; the exit model still prices the boot's Raids at minP")
  {
    const p12 = NP.nodePolicyOf(12)
    const view = { blackOp: { d: { n: 0 } }, rank: 10 }
    c3.examined(5)
    if (p12.bootRaidMinP !== BP.POLICY.bootMinP || !(p12.bootRaidMinP < BP.POLICY.bootRaidMinP)) c3.fail("BN12's bootRaidMinP must be POLICY.bootMinP, below POLICY's Raid bar", JSON.stringify({ bn12: p12.bootRaidMinP, policy: BP.POLICY.bootRaidMinP, bootMinP: BP.POLICY.bootMinP }))
    if (BP.phasePolicyOf(view, p12).raidMinP !== BP.POLICY.bootMinP || BP.phasePolicyOf(view, BP.POLICY).raidMinP !== BP.POLICY.bootRaidMinP) c3.fail("booting, BN12's chooser raids at 0.15, POLICY's at 0.25", JSON.stringify({ bn12: BP.phasePolicyOf(view, p12).raidMinP }))
    if (p12.bootMinP !== BP.POLICY.bootMinP || p12.bootSkillEveryS !== BP.POLICY.bootSkillEveryS || p12.minP !== BP.POLICY.minP) c3.fail('BN12 keeps the rest of the bootstrap and POLICY')
    if (BL.litePolicyOf(12).bootRaidMinP !== BP.POLICY.bootMinP || BL.litePolicyOf(12).pinTop !== true) c3.fail("bb-lite's lean policy in BN12 raids at the boot bar too, pinTop kept")
    const o = NP.nodePolicyOverrideOf(12)
    if (!(o && Number.isFinite(o.bootRaidMinP) && o.bootRaidMinP < BP.POLICY.minP)) c3.fail("the exit model's override carries a FINITE bar under minP (bladeExitGen then prices the Raids at minP; null would price them at 0.15)", JSON.stringify(o))
  }
  out.push(c3)

  // NP4 BN12's fleet floor: the chooser prices only fleets of 5+ infiltrators (8 sleeves), so a sub-floor incumbent yields
  const c4 = new Check('NP4', "BN12's fleet chooser picks among fleets of at least five infiltrators (8 sleeves); other nodes and smaller fleets are unconstrained")
  {
    const SP = await import('sleeveplan.js')
    const { drain } = await import('coop.js')
    const allow = NP.fleetAllowOf(12, 8)
    c4.examined(4)
    if (typeof allow !== 'function' || allow({ infiltrate: 4, support: 4, fa: 0 }) || !allow({ infiltrate: 5, support: 3, fa: 0 })) c4.fail('fleetAllowOf(12, 8) admits i5 s3 and refuses i4 s4')
    if (NP.fleetAllowOf(12, 5) !== null || NP.fleetAllowOf(13, 8) !== null) c4.fail('no floor below the measured fleet size or outside BN12')
    const FX = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tools/test/fixture-bn7-sleevecontracts.json'), 'utf8'))
    const s0 = BP.bladeStartOf({ tel: FX.tel, person: FX.person, sleeves: { infiltrate: 3, support: 5, fa: 0 }, gymExpPerSec: FX.start.gymExpPerSec, bnRank: FX.start.bnRank, skillCostMult: FX.start.skillCostMult, maxH: 60, now: Date.parse(FX.tel.at) })
    const all = BP.chooseSleeveConfig(s0, 8, BP.POLICY, { Q: 1, contracts: false })
    const floored = BP.chooseSleeveConfig(s0, 8, BP.POLICY, { Q: 1, contracts: false, allow })
    const fleet = drain(SP.bladeFleetGen(s0, 8, { infiltrate: 3, support: 5, fa: 0 }, { Q: 1, allow }))
    c4.examined(3)
    if (!all.byConfig.some((x) => x.config.infiltrate < 5)) c4.fail('the unconstrained search must price sub-floor fleets (else this check proves nothing)')
    if (!floored.byConfig.length || floored.byConfig.some((x) => x.config.infiltrate < 5)) c4.fail('chooseSleeveConfigGen allow: every priced fleet has 5+ infiltrators', floored.byConfig.map((x) => BP.sleeveConfigKey(x.config)).join(' '))
    if (!(fleet.config?.infiltrate >= 5)) c4.fail('bladeFleetGen with the floor: an i3 s5 incumbent yields to a floored fleet', JSON.stringify(fleet.config))
    const rd = (f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8')
    c4.examined(2)
    if (!/const allow = fleetAllowOf\(info\.currentNode, n\)/.test(rd('sleeve.js')) || !/bladeFleetGen\(s0, n, incumbent\.config, \{ Q: BLADE_ENSEMBLE\.Q, allow \}\)/.test(rd('sleeve.js'))) c4.fail("sleeve.js's fleet search must take the node's floor")
    if (!/chooseSleeveConfigGen\(startFor\(bladeBasis\), nSleeves, undefined, \{ Q: 1, allow: fleetAllowOf\(info\.currentNode, nSleeves\) \}\)/.test(rd('progress.js'))) c4.fail("progress.js's route fleet must take the node's floor")
  }
  out.push(c4)
  return out
}
