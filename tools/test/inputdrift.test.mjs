// [ID] THE SAME STATE GIVES THE SAME EXIT INPUTS (backlog 0h).
//
// BN5.2's entry dry-run (f43b8a3): one pass after the gift's accept the hack arm moved 14.3h -> 18.2h (8.0h ->
// 18.2h on the 2026-10-24 save). Two of its inputs were records the previous pass had written, not the state:
// eRep / eBudget (the derived objective's responses) were read back from /tel/installgate.txt — at a node's
// first pass the LAST node's (BN13: 0.6293 / 0.2476) while this pass measured 0 / 0, so the next pass (reading
// its own) moved every later life's growth; and installGainsOf's grow exponent was the gate's growShare (the
// last node's at an entry). The rest of that pass-to-pass move was the accept itself: Genesis x0.9 on every
// multiplier (Augmentations.ts:1593-1617) moves the formula's fresh life, so its income is read at the
// formula's first-income hour, 1.67h -> 2.08h (bayes.formulaRatePrior a0 = max(age, first)).
//
// fixture-bn5-entry-inputs.json: the entry pass's telemetry (the files exitInputsOf reads), BN13's gate as the
// save held it, the player as the entry inputs record it. The builder runs through progress.js's seam
// (exitInputsSeam: beginPassState, the pass's measured responses, exitInputsOf) over an ns serving those files
// and keeping what the builder writes, at the fixture's clock.
//
//   ID1 SAME STATE    two passes over the same frozen telemetry, the first pass's publications (its gate, the
//                     files the builder wrote) in between, build identical inputs; and they reproduce the entry
//                     pass's published split income (one builder, one telemetry)
//   ID2 THIS PASS'S   eRep / eBudget are what this pass measured (0 / 0), never the gate's (BN13's 0.63 / 0.25);
//                     a pass that measured none prices none, even on a gate of this life, nor the last pass's
//   ID3 GROW SHARE    with the batcher landing, a grow-carrying batch's income gain is the same on both passes:
//                     growMult ^ (this batcher's grow share), not the last node's
//   ID6 HACKNET       the hacknet model (hacknet.js's /tel/hacknet.txt) is priced at the player's multipliers:
//                     hacknet.js's copy is from its own last run, and lagged the accept by a pass (BN2.2 dry-run)
//   ID4 INPUT DRIFT  evaluate.inputDriftOf names an input that moved with nothing moving it (the BN5.2 eRep),
//                     passes a clock-only move, the accept's exact x0.9, act.js's moves; fails x0.8 at an accept,
//                     x0.9 without one, and an unlisted input
//   ID5 WIRING        the dry-run passes the entry twice with nothing between and checks every consecutive pair
import './gameresolve.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { Check } from './harness.mjs'
import { REPO_ROOT } from './gameresolve.mjs'

const P = await import('../../progress.js')
const { inputDriftOf } = await import('../sim/entry/evaluate.mjs')
const FX = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tools/test/fixture-bn5-entry-inputs.json'), 'utf8'))
const GATE = '/tel/installgate.txt'
const infoOf = (i) => ({ ...i, ownedAugs: new Map(i.ownedAugs), ownedSF: new Map(i.ownedSF) })

/** An ns over a file map: read/write only, the rest the builder touches answered as the dry-run's state. */
function nsOver(files) {
  return {
    read: (f) => files.get(f) ?? '',
    write: (f, d, mode) => files.set(f, mode === 'a' ? (files.get(f) ?? '') + d : d),
    gang: { inGang: () => false },
    getServerMoneyAvailable: () => 0,
    getTotalScriptIncome: () => [0, 0],
  }
}
/** One pass's build: the pass begun (act()'s beginPassState), its measured responses set, the one builder. */
function pass(files, { measured = FX.measured, plan = null, offers = [], unmeasured = false } = {}) {
  const ns = nsOver(files)
  const info = infoOf(FX.info)
  const now = Date.now
  Date.now = () => FX.now
  try {
    P.exitInputsSeam.beginPass(ns, info)
    if (!unmeasured) P.exitInputsSeam.measured(measured)
    return P.exitInputsSeam.build(ns, info, structuredClone(FX.player), null, 0, 0, offers, [], plan, [], { expToPlayerHacking: 0, factionRepPerSec: 0 })
  } finally {
    Date.now = now
  }
}
/** The gate the pass publishes (its derived objective's record), as act() writes it at the pass's end. */
function publishGate(files, m) {
  files.set(GATE, JSON.stringify({ at: new Date(FX.now).toISOString(), lastAugReset: FX.info.lastAugReset, eObsNode: FX.info.currentNode, eBudget: m.eBudget, objective: { eRep: m.eRep, eBudget: m.eBudget, chanceObs: m.chanceObs, growShare: m.growShare } }))
}
const leaves = (o, p = '', out = new Map()) => {
  if (o && typeof o === 'object' && !Array.isArray(o)) for (const [k, v] of Object.entries(o)) leaves(v, p ? `${p}.${k}` : k, out)
  else out.set(p, JSON.stringify(o))
  return out
}
const diffOf = (a, b) => {
  const A = leaves(a)
  const B = leaves(b)
  return [...new Set([...A.keys(), ...B.keys()])].filter((k) => A.get(k) !== B.get(k)).map((k) => `${k}: ${String(A.get(k)).slice(0, 60)} -> ${String(B.get(k)).slice(0, 60)}`)
}

export async function run() {
  const out = []

  const c1 = new Check('ID1', 'the same frozen telemetry, built a pass apart, gives identical exit inputs')
  {
    const files = new Map(Object.entries(FX.files))
    const A = pass(files)
    publishGate(files, FX.measured)
    const B = pass(files)
    c1.examined(2)
    const d = diffOf(A, B)
    if (d.length) c1.fail(`the exit inputs moved between two passes over one state (${d.length} input(s))`, d.slice(0, 8).join('; '))
    const want = FX.published.splitHackPerSec
    const got = A.split?.hackPerSec
    c1.note(`split income $${got?.toExponential(4)}/s vs the entry pass's published $${want?.toExponential(4)}/s; ${leaves(A).size} inputs compared`)
    if (!(Math.abs(got / want - 1) < 1e-6)) c1.fail('the seam does not reproduce the entry pass\'s published income (not the same builder or telemetry)', `${got} vs ${want}`)
  }
  out.push(c1)

  const c2 = new Check('ID2', "eRep / eBudget are this pass's measured responses, never the gate record's")
  {
    const files = new Map(Object.entries(FX.files))
    const g = JSON.parse(files.get(GATE))
    const A = pass(files)
    c2.examined(3)
    c2.note(`gate (node ${g.eObsNode}): eRep ${g.objective.eRep} eBudget ${g.eBudget}; this pass measured ${FX.measured.eRep} / ${FX.measured.eBudget}; the entry pass published ${FX.published.eRep} / ${FX.published.eBudget}`)
    if (A.eRep !== FX.measured.eRep || A.eBudget !== FX.measured.eBudget) c2.fail("the inputs' responses are not this pass's measurement", `eRep ${A.eRep} eBudget ${A.eBudget} vs ${FX.measured.eRep} / ${FX.measured.eBudget}`)
    // this node's own gate, of this life, and a pass that measured nothing: still nothing
    publishGate(files, { eRep: 0.4, eBudget: 0.3, chanceObs: 1, growShare: 0.5 })
    const N = pass(files, { measured: null })
    if (N.eRep !== null || N.eBudget !== null) c2.fail('a pass that measured no responses priced the gate record\'s', `eRep ${N.eRep} eBudget ${N.eBudget}`)
    // a build before this pass has measured (the pass after one that measured 0 / 0): none, not the last pass's
    pass(files)
    const U = pass(files, { unmeasured: true })
    c2.examined(1)
    if (U.eRep !== null || U.eBudget !== null) c2.fail("a build before the pass measured carried the previous pass's responses", `eRep ${U.eRep} eBudget ${U.eBudget}`)
  }
  out.push(c2)

  const c3 = new Check('ID3', "a grow-carrying batch's income gain is the batcher's grow share this pass, on both passes")
  {
    const files = new Map(Object.entries(FX.files))
    const bt = JSON.parse(files.get('/tel/batch.txt'))
    // SEEDED: the batcher landing on one target, grow 1/4 of the threads (BN13's gate says 0.588)
    bt.targets = [{ ...(bt.targets?.[0] ?? {}), plan: { h: 1, g: 1, w1: 1, w2: 1 }, cal: { ...(bt.targets?.[0]?.cal ?? {}), chanceObs: 0.9 } }]
    files.set('/tel/batch.txt', JSON.stringify(bt))
    const offers = [{ name: 'SeededGrowAug', faction: 'CyberSec', mults: { hacking_grow: 1.5 }, repReq: 1, price: 1, factionRep: 0 }]
    const plan = { buy: [{ name: 'SeededGrowAug' }], logM: 0.1 }
    const A = pass(files, { plan, offers })
    publishGate(files, { ...FX.measured, chanceObs: 0.9, growShare: 0.25 })
    const B = pass(files, { plan, offers })
    c3.examined(2)
    const want = Math.pow(1.5, 0.25)
    c3.note(`income gain ${A.installGains?.income} then ${B.installGains?.income} (want 1.5^0.25 = ${want.toFixed(6)})`)
    if (!(Math.abs(A.installGains?.income - want) < 1e-9) || !(Math.abs(B.installGains?.income - want) < 1e-9)) c3.fail("the batch's grow exponent is not this batcher's share on both passes", `${A.installGains?.income} / ${B.installGains?.income} vs ${want}`)
  }
  out.push(c3)

  const c6 = new Check('ID6', "the hacknet model is priced at the player's multipliers, not hacknet.js's last copy")
  {
    // the pass right after the accept: Genesis x0.9 in the player's multipliers, hacknet.txt from before it
    const files = new Map(Object.entries(FX.files))
    const hk = JSON.parse(files.get('/tel/hacknet.txt'))
    const player = structuredClone(FX.player)
    for (const k of Object.keys(hk.model?.mults ?? {})) player.mults[k] = hk.model.mults[k] * (k === 'hacknet_node_money' ? 0.9 : 1 / 0.9)
    const now = Date.now
    Date.now = () => FX.now
    let A
    try {
      const ns = nsOver(files)
      P.exitInputsSeam.beginPass(ns, infoOf(FX.info))
      P.exitInputsSeam.measured(FX.measured)
      A = P.exitInputsSeam.build(ns, infoOf(FX.info), player, null, 0, 0, [], [], null, [], { expToPlayerHacking: 0, factionRepPerSec: 0 })
    } finally {
      Date.now = now
    }
    c6.examined(1)
    const bad = Object.keys(hk.model?.mults ?? {}).filter((k) => A.hacknet?.mults?.[k] !== player.mults[k])
    if (!hk.model?.mults || !A.hacknet) c6.fail('the fixture carries no hacknet model to check')
    else if (bad.length) c6.fail("the hacknet model's multipliers are hacknet.js's copy, not the player's", bad.map((k) => `${k} ${A.hacknet.mults[k]} vs ${player.mults[k]}`).join('; '))
  }
  out.push(c6)

  const c4 = new Check('ID4','INPUT DRIFT names an input moved by nothing, and passes the moves the state explains')
  {
    const files = new Map(Object.entries(FX.files))
    const A = pass(files)
    const v = (mut) => {
      const x = structuredClone(A)
      mut(x)
      return x
    }
    const cases = [
      ['the BN5.2 entry: eRep / eBudget off the last node', v((x) => Object.assign(x, { eRep: 0.6293, eBudget: 0.2476 })), [], /eRep/],
      ['real time: money, the measured rates, the market', v((x) => Object.assign(x, { money: x.money + 2400, incomePerSec: x.incomePerSec * 1.01, capitalCap: (x.capitalCap ?? 1) * 1.001 })), [], null],
      ["the accept: Genesis's x0.9 and what the multipliers move", v((x) => Object.assign(x, { hackingMult: x.hackingMult * 0.9, incomePerSec: x.incomePerSec * 0.67, repPerSec: x.repPerSec * 0.9, freshHackCum: x.freshHackCum.map(([h, m]) => [h, m * 0.5]) })), ['accept'], null],
      ['an accept that moved hacking by x0.8', v((x) => Object.assign(x, { hackingMult: x.hackingMult * 0.8 })), ['accept'], /hackingMult/],
      ['x0.9 with no accept', v((x) => Object.assign(x, { hackingMult: x.hackingMult * 0.9 })), [], /hackingMult/],
      ['the multipliers moved with no accept (the fresh life)', v((x) => Object.assign(x, { freshHackCum: x.freshHackCum.map(([h, m]) => [h, m * 0.5]) })), ['join'], /freshHackCum/],
      ["act.js's orders: money spent, the responses re-measured", v((x) => Object.assign(x, { money: 10, eRep: 0.2 })), ['act'], null],
      ['an input no event lists', v((x) => Object.assign(x, { newInput: 3 })), ['act', 'accept'], /newInput/],
      ['a static input moved (the exit level)', v((x) => Object.assign(x, { exitLevel: (x.exitLevel ?? 1) * 2 })), ['act', 'accept', 'join'], /exitLevel/],
    ]
    for (const [what, next, events, re] of cases) {
      c4.examined(1)
      const F = inputDriftOf({ prev: A, next, events, from: 'a', to: 'b' })
      if (re && !(F.length && F[0].kind === 'INPUT DRIFT' && F[0].level === 'fail' && re.test(F[0].what))) c4.fail(`${what}: expected INPUT DRIFT naming ${re}`, JSON.stringify(F).slice(0, 300))
      if (!re && F.length) c4.fail(`${what}: flagged a move the state explains`, JSON.stringify(F).slice(0, 300))
    }
    if (inputDriftOf({ prev: A, next: structuredClone(A) }).length) c4.fail('identical inputs flagged')
  }
  out.push(c4)

  const c5 = new Check('ID5', 'the dry-run passes the entry twice with nothing between, and checks every consecutive pair')
  {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'tools/sim/entry/dryrun.mjs'), 'utf8')
    c5.examined(3)
    if (!/await plannerPass\('progress\.js'\)\s*\n(\s*\/\/[^\n]*\n)*\s*await plannerPass\('progress\.js \(again\)'\)/.test(src)) c5.fail("the 'again' pass must follow the entry pass with nothing acting between")
    for (const ph of ['entry', 'accepted', 'joined']) if (!new RegExp(`driftSince\\('${ph}'\\)`).test(src)) c5.fail(`the ${ph} pass's inputs are not checked against the pass before`)
  }
  out.push(c5)
  return out
}
