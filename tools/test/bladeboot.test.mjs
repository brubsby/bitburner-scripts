// THE BLADEBURNER BOOTSTRAP POLICY (bbplan POLICY.bootMinP / bootSkillEveryS / bootBlackOps):
// node start -> the first black op at a lower candidate bar and a faster skill cadence.
//
//   BBOOT1  phasePolicyOf: the boot bar before the first bootBlackOps black ops, the steady policy after;
//           POLICY carries a boot bar below minP and a boot cadence faster than skillEveryS
//   BBOOT2  chooseAction / skillScore apply it: on states where the best EV/s action sits between
//           bootMinP and minP the booting pick takes it and the steady pick cannot; never below the bar
//   BBOOT3  the cadence is wired where the points are spent: bladeburner.js and bb-lite.js through
//           skillEveryOf (no bare POLICY.skillEveryS clock), the exit model (bladeExitGen) and bbsim too
//   BBOOT5  the exit model prices the boot with Raid at minP (uncalibrated low-chance Raid dynamics)
//   BBOOT4  THE COMPARISON (CLAUDE.md "Tests assert the comparison"): bbsim, the game's classes, BN5.2
//           as entered next, paired seeds: the exit WITH the bootstrap policy minus WITHOUT is < 0
//
// Measured: tools/sim/bbboot.mjs --levers (the header of POLICY.bootMinP has the table).

import './gameresolve.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { Check } from './harness.mjs'
import { REPO_ROOT } from './gameresolve.mjs'

const bp = await import('bbplan.js')

export async function run() {
  const checks = []
  const P = bp.POLICY

  {
    const c = new Check('BBOOT1', 'phasePolicyOf: bootMinP before bootBlackOps black ops are done, POLICY after; the boot bar < minP and the boot cadence < skillEveryS')
    checks.push(c)
    c.examined(1)
    if (!(Number.isFinite(P.bootMinP) && P.bootMinP > 0 && P.bootMinP < P.minP)) c.fail(`POLICY.bootMinP ${P.bootMinP} is not a bar below minP ${P.minP}`)
    if (!(Number.isFinite(P.bootSkillEveryS) && P.bootSkillEveryS < P.skillEveryS)) c.fail(`POLICY.bootSkillEveryS ${P.bootSkillEveryS} is not faster than skillEveryS ${P.skillEveryS}`)
    const n = P.bootBlackOps ?? 1
    for (let k = 0; k <= Math.min(20, n + 2); k++) {
      c.examined(1)
      const pol = bp.phasePolicyOf({ blackOp: { d: bp.BLACK_OPS[k] } }, P)
      const want = k < n ? P.bootMinP : P.minP
      if (pol.minP !== want) c.fail(`next black op #${k}: minP ${pol.minP}, want ${want}`)
      const every = bp.skillEveryOf(P, k, 0)
      if (every !== (k < n ? P.bootSkillEveryS : P.skillEveryS)) c.fail(`skillEveryOf(POLICY, ${k}, rank 0) = ${every}`)
    }
    // the boot ends at the op's RANK too (the priced rule may hold a rank-gated op for hours)
    const reqd = bp.BLACK_OPS[n - 1].reqdRank
    c.examined(2)
    if (bp.phasePolicyOf({ rank: reqd, blackOp: { d: bp.BLACK_OPS[0] } }, P).minP !== P.minP) c.fail(`rank ${reqd} (the op's reqdRank) still boots`)
    if (bp.skillEveryOf(P, 0, reqd) !== P.skillEveryS) c.fail(`skillEveryOf at rank ${reqd} is still the boot cadence`)
    c.examined(1)
    if (bp.phasePolicyOf({ blackOp: null }, P).minP !== P.minP) c.fail('every black op done (blackOp null) still boots')
    if (bp.phasePolicyOf({ blackOp: { d: bp.BLACK_OPS[0] } }, { ...P, bootMinP: undefined }).minP !== P.minP) c.fail('a policy without bootMinP boots')
  }

  {
    const c = new Check('BBOOT2', 'chooseAction and skillScore apply the boot bar: some state picks an action with bootMinP <= p < minP while booting, none after; never below the bar')
    checks.push(c)
    const person = { skills: { hacking: 100, strength: 150, defense: 150, dexterity: 150, agility: 150, charisma: 30, intelligence: 150 }, mults: {} }
    const view = (K, bo) => ({
      person, sm: {}, levels: {}, bnRank: 1, rank: 100, stamina: 100, maxStamina: 100, staminaGain: 1, resting: false,
      cities: [{ name: 'Sector-12', pop: 1e9, chaos: 0, comms: 20 }], city: 'Sector-12', ref: { pop: 1e9, chaos: 0 },
      actions: bp.LEVELED.map((d) => ({ d, count: 100, maxLevel: 20, K: K * (d.kind === 'contract' ? 4 : 1), width: 0 })),
      blackOp: { d: bp.BLACK_OPS[bo], K: 1e-3, width: 0 },
    })
    let between = 0
    let scoreDiff = 0
    for (let i = 0; i <= 80; i++) {
      const K = Math.exp(Math.log(1e-4) + (i / 80) * Math.log(1e6))
      const boot = bp.chooseAction(view(K, 0))
      const steady = bp.chooseAction(view(K, P.bootBlackOps ?? 1))
      c.examined(2)
      if (Number.isFinite(boot.p) && boot.p < P.bootMinP - 1e-12) c.fail(`booting picked ${boot.name} L${boot.level} at p ${boot.p} < bootMinP ${P.bootMinP} (K ${K})`)
      const raidBar = Number.isFinite(P.bootRaidMinP) ? P.bootRaidMinP : P.bootMinP
      if (boot.name === 'Raid' && Number.isFinite(boot.p) && boot.p < raidBar - 1e-12) c.fail(`booting picked Raid L${boot.level} at p ${boot.p} < its bar ${raidBar} (K ${K})`)
      if (Number.isFinite(steady.p) && steady.p < P.minP - 1e-12) c.fail(`after the boot picked ${steady.name} L${steady.level} at p ${steady.p} < minP ${P.minP} (K ${K})`)
      if (Number.isFinite(boot.p) && boot.p < P.minP && (boot.name !== steady.name || boot.level !== steady.level)) between++
      const s0 = bp.skillScore(view(K, 0), P)
      const s1 = bp.skillScore(view(K, P.bootBlackOps ?? 1), P)
      if (s0.kind === 'rank' && s1.kind === 'rank' && s0.v !== s1.v) scoreDiff++
    }
    if (between === 0) c.fail('no state on the K grid made the booting chooser take an action between bootMinP and minP: the boot bar is not applied by chooseAction')
    if (scoreDiff === 0) c.fail('skillScore is the same booting and after on every K: the skill objective ignores the boot bar (the measured win needs both)')
  }

  {
    const c = new Check('BBOOT3', 'the boot cadence is wired where skill points are spent: bladeburner.js, bb-lite.js (skillEveryOf, no bare POLICY.skillEveryS clock) and bladeExitGen')
    checks.push(c)
    for (const f of ['bladeburner.js', 'bb-lite.js']) {
      const src = fs.readFileSync(path.join(REPO_ROOT, f), 'utf8')
      c.examined(1)
      if (!/skillEveryOf\(\s*POLICY\s*,.*\brank\b.*\)\s*\*\s*1000/.test(src)) c.fail(`${f} does not spend on skillEveryOf(POLICY, blackOpsDone, rank)`)
      if (/POLICY\.skillEveryS\s*\*\s*1000/.test(src)) c.fail(`${f} still times its spends on the bare POLICY.skillEveryS`)
    }
    const src = fs.readFileSync(path.join(REPO_ROOT, 'bbplan.js'), 'utf8')
    c.examined(1)
    if (!/lastSkill\s*>=\s*\(s0\.skillEveryS \?\? skillEveryOf\(pol, st\.bo, st\.rank\)/.test(src)) c.fail('bladeExitGen does not price the boot cadence (skillEveryOf(pol, st.bo, st.rank))')
    // the measuring sim plays it too (its --levers table is what POLICY.bootMinP's note cites)
    const sim = fs.readFileSync(path.join(REPO_ROOT, 'tools/sim/nodechoice/bbsim.mjs'), 'utf8')
    c.examined(1)
    if (!/bp\.skillEveryOf\(sharedPol, bb\.numBlackOpsComplete, bb\.rank\)/.test(sim)) c.fail('bbsim (pol.shared) does not spend on skillEveryOf: the sim no longer plays the policy it measured')
  }

  {
    const c = new Check('BBOOT4', 'bbsim BN5.2 (the next node as entered), paired seeds: exit WITH the bootstrap policy - WITHOUT < 0')
    checks.push(c)
    let runOne
    try {
      const m = await import('../sim/bbboot.mjs')
      runOne = m.runOne
      const CELLS = m.CELLS
      const d = []
      for (const seed of [201, 202, 203]) {
        const off = runOne({ ...CELLS['BN5.2'], seed, maxH: 40, arm: { sharedPolicy: { bootMinP: null, bootSkillEveryS: null } } })
        const on = runOne({ ...CELLS['BN5.2'], seed, maxH: 40, arm: {} })
        c.examined(2)
        if (!(on.hours > 0 && off.hours > 0)) c.fail(`seed ${seed}: an arm did not finish (with ${on.hours}, without ${off.hours})`)
        else d.push(on.hours - off.hours)
      }
      const mean = d.reduce((a, b) => a + b, 0) / Math.max(1, d.length)
      if (!(mean < 0)) c.fail(`with - without = ${mean.toFixed(3)}h over seeds 201-203 (per seed ${d.map((x) => x.toFixed(2)).join(', ')}): the bootstrap policy does not shorten the exit`)
    } catch (e) {
      c.fail('the comparison could not run — NOT a pass', String(e?.stack ?? e).slice(0, 500))
    }
  }
  {
    const c = new Check('BBOOT5', 'the exit model prices the boot with Raid at minP (its low-chance Raid dynamics are uncalibrated: bladeExitGen note); the Raid bar matters on the state checked')
    checks.push(c)
    const F = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tools/test/fixture-bn6-bladecal-1322.json'), 'utf8'))
    const tel = { ...F.bladeburner, rank: 300, skillPoints: 0, cities: F.bladeburner.cities.map((x) => ({ ...x, pop: F.save.cities[x.name].pop })) }
    const s0 = bp.bladeStartOf({ tel, person: F.player, sleeves: { infiltrate: 4, support: 4, fa: 0 }, gymExpPerSec: 30, bnRank: 1, maxH: 200 })
    const h = (pol) => bp.bladeExit(s0, pol).hours
    const shipped = h(P)
    const atMinP = h({ ...P, bootRaidMinP: P.minP })
    const atBoot = h({ ...P, bootRaidMinP: null })
    c.examined(3)
    c.note(`BN6 13:22Z state at rank 300: POLICY ${shipped?.toFixed(3)}h, Raid at minP ${atMinP?.toFixed(3)}h, Raid at bootMinP ${atBoot?.toFixed(3)}h; bbsim (bbboot.mjs, 40 seeds): BN5.2 no gift -0.72 +- 0.08h vs this model's -0.69h`)
    if (!Number.isFinite(P.bootRaidMinP) || !(P.bootRaidMinP < P.minP)) c.fail(`POLICY.bootRaidMinP ${P.bootRaidMinP} is not a Raid bar below minP`)
    if (shipped !== atMinP) c.fail(`the exit model priced the daemon's Raid bar (${shipped}h) instead of minP's (${atMinP}h)`)
    if (atBoot === atMinP) c.fail('the Raid bar moves nothing on this state: the check above is vacuous')
  }
  return checks
}
