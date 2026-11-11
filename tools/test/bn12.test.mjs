// [BN12] THE BN12 LOOP — "BN12 forever, and see how low the exit time gets" (the user, 2026-11-11).
//
// Every capped Source-File is at 3, so from BN12.2 on the stack plays BitNode 12 again and again, one level
// harsher each time (tools/sim/gameplan/bn12.mjs). These checks hold the loop's unattended path and its
// measurement:
//
//   BN1  THE NEXT NODE   nothing owed -> BitNode 12 at the next level, from/fromSF the node in progress, and
//                        the watchdog hands exactly that to endgame.js (nextNodeArgsOf), and only in that clear;
//                        endgame.js's replay guard never refuses 12; plan.mjs writes it when nothing is owed
//                        (2026-11-11: the whole-game DP threw on the empty lattice and next-node.txt stayed
//                        BN15.1 from BN8 — the entry dry-run ran BN15.1)
//   BN2  THE MULTIPLIERS bn12MultsOf(L) = the game's getBitNodeMultipliers(12, L) for L 1..40 (Daedalus 31 until
//                        inc >= 2), and the labyrinth gives no Red Pill in BN12 (DarknetLabyrinthRewardsTheRedPill 0)
//   BN3  THE BOARD       a same-node replay is two clears (the SF rises); a BitVerse transit is no clear; the
//                        prediction is the plan decided IN the clear (the previous clear's plan.txt, decided
//                        before the entry, is never this clear's — BN5.3's 0.035h, 2026-10-24); the residual is
//                        ln(active / predicted); sleep gaps come off; the Go capture survives the node's end
//   BN4  THE AUTO LEGS   a finished BN12 Bladeburner clear states its Go farm (Tetrads / hours in) as its
//                        CLEAR_LEGS, so its k is read, not WITHHELD; a hand entry wins; BN12 is read at its level
//   BN5  THE ANCHOR      bladeAnchorOf: A = measured / r(level), price A x r(L), the leave-one-out
//   BN6  THE RUN RECORD  telrecord: node-entry's planEstimate and the node-plan event take only a plan decided
//                        in this node (planOfNode)
import './gameresolve.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Check } from './harness.mjs'
import { REPO_ROOT } from './gameresolve.mjs'

const B = await import('../sim/gameplan/bn12.mjs')
const code = (f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8')
const H = 3.6e6

export async function run() {
  const checks = []

  {
    const c = new Check('BN1', 'THE NEXT NODE: nothing owed -> BN12 at the next level; the watchdog passes it in that clear only; endgame never refuses 12; plan.mjs writes it')
    const SF = [[1, 3], [2, 3], [3, 3], [4, 3], [5, 3], [6, 3], [7, 3], [8, 3], [9, 3], [10, 3], [11, 3], [13, 3], [14, 3], [15, 3]]
    const cases = [
      [12, [...SF, [12, 1]], { next: 12, level: 3, label: 'BN12.3', from: 12, fromSF: 1 }],
      [15, [...SF, [12, 1]], { next: 12, level: 2, label: 'BN12.2', from: 15, fromSF: 3 }],
      [12, [...SF, [12, 7]], { next: 12, level: 9, label: 'BN12.9', from: 12, fromSF: 7 }],
    ]
    for (const [node, sf, want] of cases) {
      c.examined(1)
      const got = B.bn12NextOf({ node, sfPairs: sf })
      if (JSON.stringify(got) !== JSON.stringify(want)) c.fail(`bn12NextOf(BN${node}, SF12 ${new Map(sf).get(12)}) = ${JSON.stringify(got)}`, `want ${JSON.stringify(want)}`)
    }
    const wd = await import('../../watchdog.js')
    const nsOf = (rec, node, lvl) => ({ read: () => JSON.stringify(rec), getResetInfo: () => ({ currentNode: node, ownedSF: new Map([[node, lvl]]) }) })
    const fb = ['--next', 12]
    const rec = B.bn12NextOf({ node: 12, sfPairs: [[12, 1]] })
    for (const [node, lvl, want] of [[12, 1, ['--next', 12]], [12, 2, fb], [15, 1, fb]]) {
      c.examined(1)
      const got = wd.nextNodeArgsOf(nsOf(rec, node, lvl), fb)
      if (JSON.stringify(got) !== JSON.stringify(want)) c.fail(`nextNodeArgsOf(${JSON.stringify(rec)}) in BN${node} at SF${node}.${lvl} = ${JSON.stringify(got)}`, `want ${JSON.stringify(want)}`)
    }
    const eg = code('endgame.js')
    if (!/n === 12\) return null/.test(eg)) c.fail("endgame.js's replay guard no longer exempts BitNode 12 (SF12 has no cap: the loop would hold at every exit)")
    const wdc = code('watchdog.js')
    if (!/script: 'endgame\.js',[\s\S]{0,80}args: \['--next', 12\]/.test(wdc)) c.fail("the watchdog's hand fallback for endgame.js is not --next 12 (the loop's floor when next-node.txt is stale)")
    const pm = code('tools/sim/gameplan/plan.mjs')
    if (!/if \(!owed\(start\)\.length\) \{[\s\S]{0,400}bn12NextOf/.test(pm) || !/next-node\.txt[\s\S]{0,200}\.\.\.nx/.test(pm)) c.fail('plan.mjs does not write the BN12 loop\'s next node when nothing is owed')
    const sh = code('tools/plan-on-node.sh')
    if (!/tools\/bn12board\.mjs/.test(sh)) c.fail('tools/plan-on-node.sh does not run the BN12 board every pass (the Go farm capture and the measurement)')
    checks.push(c)
  }

  {
    const c = new Check('BN2', "THE MULTIPLIERS: bn12MultsOf = the game's getBitNodeMultipliers(12, L); no labyrinth Red Pill in BN12")
    const { nodeMults } = await import('../sim/nodechoice/hackexit.mjs')
    for (let L = 1; L <= 40; L++) {
      const mine = B.bn12MultsOf(L)
      const game = nodeMults(12, L)
      for (const [k, v] of Object.entries(mine)) {
        if (k === 'inc') continue
        c.examined(1)
        if (Math.abs(game[k] - v) > 1e-12 * Math.max(1, Math.abs(v))) c.fail(`BN12.${L} ${k}: bn12.mjs ${v}, the game ${game[k]}`)
      }
    }
    if (B.bn12MultsOf(2).DaedalusAugsRequirement !== 31 || B.bn12MultsOf(36).DaedalusAugsRequirement !== 32) c.fail('Daedalus: 31 augmentations at BN12.2, 32 once 1.02^L >= 2 (L 36)')
    checks.push(c)
  }

  {
    const c = new Check('BN3', 'THE BOARD: replays split, transits dropped, the prediction is the clear\'s own plan, residual ln(active / predicted), gaps off, Go capture kept')
    const t0 = Date.parse('2026-11-12T00:00:00Z')
    const iso = (h) => new Date(t0 + h * H).toISOString()
    const sf = (l12) => ({ ctor: 'JSONMap', data: [[6, 3], [7, 3], [12, l12], [14, 3]] })
    const row = (h, node, l12, reset, extra = {}) => ({ at: iso(h), bitNode: node, sourceFiles: sf(l12), lastNodeReset: reset, lastAugReset: reset, skills: { hacking: 300, strength: 200, defense: 200, dexterity: 200, agility: 200 }, bladeburner: null, ...extra })
    const r1 = t0
    const r2 = t0 + 7 * H
    const rows = [
      row(0.05, 12, 1, r1),
      row(0.5, 12, 1, r1, { bladeburner: { rank: 10, blackOpsDone: 0 } }),
      row(3.5, 12, 1, r1, { bladeburner: { rank: 3e4, blackOpsDone: 1 } }),
      row(6.9, 12, 1, r1, { bladeburner: { rank: 4e5, blackOpsDone: 21 } }),
      // the replay: SF12 1 -> 2, a new lastNodeReset
      row(7.05, 12, 2, r2),
      row(7.6, 12, 2, r2, { bladeburner: { rank: 5, blackOpsDone: 0 } }),
    ]
    const segs = B.segmentsOfRows(rows)
    const runRows = [
      // the PREVIOUS clear's plan (decided before the entry): never this clear's prediction
      { at: iso(0.01), plan: { node: 12, decidedAt: iso(-0.5), exit: { meanH: 0.04, q50: 0.04 } }, route: { route: 'blade' } },
      { at: iso(0.1), plan: { node: 12, decidedAt: iso(0.08), exit: { meanH: 12, q50: 11 } }, route: { route: 'blade' } },
      { at: iso(1.2), plan: { node: 12, decidedAt: iso(1.1), exit: { meanH: 6, q50: 6 } }, route: { route: 'blade' } },
      { at: iso(7.02), plan: { node: 12, decidedAt: iso(6.5), exit: { meanH: 0.01, q50: 0.01 } }, route: { route: 'blade' } },
    ]
    const events = [{ kind: 'sleep-gap', at: iso(2.5), sec: 1800 }]
    const prev = { clears: [{ key: `12@${r1}`, go: { t: t0 + 6.8 * H, at: iso(6.8), hoursIn: 6.8, np: { Tetrads: 68000 } } }] }
    const goHist = { samples: [{ t: t0 + 7.5 * H, np: { Tetrads: 900 } }] }
    const b = B.boardOf({ segs, runRows, events, prev, goHist, now: t0 + 8 * H })
    c.examined(b.clears.length)
    if (b.clears.length !== 2) c.fail(`the replay is ${b.clears.length} clear(s), want 2 (BN12.2 finished, BN12.3 in progress)`, JSON.stringify(b.clears.map((x) => x.label)))
    const [a, n] = b.clears
    if (a?.label !== 'BN12.2' || !a.done || Math.abs(a.wallH - 7) > 1e-9 || Math.abs(a.gapH - 0.5) > 1e-9 || Math.abs(a.activeH - 6.5) > 1e-9) c.fail(`BN12.2: ${JSON.stringify({ label: a?.label, done: a?.done, wallH: a?.wallH, gapH: a?.gapH, activeH: a?.activeH })}`, 'want BN12.2 done, wall 7h, gap 0.5h, active 6.5h')
    if (a?.route !== 'blade' || a?.milestones?.bo1H !== 3.5 || a?.milestones?.bo21H !== 6.9 || a?.milestones?.joinH !== 0.5) c.fail(`BN12.2's route / milestones ${a?.route} ${JSON.stringify(a?.milestones)}`)
    if (a?.predicted?.entry?.meanH !== 12 || Math.abs(a?.predicted?.entry?.totalH - 12.1) > 1e-9) c.fail(`BN12.2's entry prediction is ${JSON.stringify(a?.predicted?.entry)}: the plan decided before the entry (the previous clear's) is never this clear's`, 'want meanH 12 at +0.1h')
    if (a?.predicted?.late?.meanH !== 6) c.fail(`BN12.2's 1h prediction ${JSON.stringify(a?.predicted?.late)}`)
    if (!a?.resid || Math.abs(a.resid.entry - +Math.log(6.5 / 12.1).toFixed(3)) > 1e-9) c.fail(`BN12.2's residual ${JSON.stringify(a?.resid)}, want ln(6.5 / 12.1)`)
    if (a?.go?.np?.Tetrads !== 68000) c.fail(`BN12.2's Go capture was lost at its end (go-dash-history.json only keeps the node in progress): ${JSON.stringify(a?.go)}`)
    if (n?.label !== 'BN12.3' || n.done || n?.go?.np?.Tetrads !== 900) c.fail(`BN12.3 in progress with its own capture: ${JSON.stringify({ label: n?.label, done: n?.done, go: n?.go })}`)
    if (n?.predicted?.entry) c.fail(`BN12.3 took the previous clear's plan (decided ${n.predicted.entry.at}) as its prediction`)
    if (b.best?.[2]?.activeH !== 6.5 || b.calibration?.n !== 1) c.fail(`the leaderboard / calibration ${JSON.stringify({ best: b.best, cal: b.calibration })}`)
    // a BitVerse transit: the destroyed node with its SF already raised, 0.76h, no exit
    const tr = B.segmentsOfRows([row(0.05, 12, 0, null), row(20, 12, 0, null, { bladeburner: { rank: 4e5, blackOpsDone: 21 } }), row(21, 12, 1, null), row(21.7, 12, 1, null), row(21.76, 7, 0, null)])
    const bt = B.boardOf({ segs: tr, now: t0 + 30 * H })
    c.examined(1)
    if (bt.clears.map((x) => x.label).join(',') !== 'BN12.1') c.fail(`the BitVerse transit read as a clear: ${bt.clears.map((x) => `${x.label} ${x.wallH}h`).join(', ')}`)
    checks.push(c)
  }

  {
    const c = new Check('BN4', "THE AUTO LEGS: a finished BN12 Bladeburner clear states its own Go farm; a hand entry wins; BN12 is read at its level")
    const board = { clears: [
      { label: 'BN12.2', done: true, route: 'blade', activeH: 6.5, sfOnEntry: [[12, 1], [14, 3]], go: { hoursIn: 6.4, np: { Tetrads: 64000 } } },
      { label: 'BN12.3', done: true, route: 'blade', activeH: 7, sfOnEntry: [[12, 2], [14, 3]], go: null },
      { label: 'BN12.4', done: false, route: 'blade', sfOnEntry: [[12, 3]], go: { hoursIn: 1, np: { Tetrads: 9000 } } },
    ] }
    const L = B.autoClearLegsOf(board, 0.7)
    c.examined(3)
    if (L['BN12.2']?.go?.perHour !== 10000 || L['BN12.2'].go.goPower !== 1 || L['BN12.2'].go.sf14 !== 1 || L['BN12.2'].go.power !== 0.7) c.fail(`BN12.2's auto leg ${JSON.stringify(L['BN12.2'])}`, 'want Tetrads 64000 / 6.4h = 10000/h at GoPower 1 with the SF14 doubling')
    if (!('BN12.3' in L) || L['BN12.3'].go !== null) c.fail(`BN12.3 (no capture) must be stated with no farm, not left unstated: ${JSON.stringify(L['BN12.3'])}`)
    if ('BN12.4' in L) c.fail('a clear in progress has no leg yet')
    const O = await import('../sim/gameplan/observe.mjs')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bn12-'))
    try {
      fs.writeFileSync(path.join(dir, 'bn12-board.json'), JSON.stringify(board))
      const legs = O.clearLegsOf(dir)
      if (legs['BN12.2']?.go?.perHour !== 10000) c.fail('observe.clearLegsOf does not carry the board\'s auto legs')
      if (JSON.stringify(legs['BN14.2']) !== JSON.stringify(O.CLEAR_LEGS['BN14.2'])) c.fail('a hand CLEAR_LEGS entry must win over the auto ones')
      // the k reading: read, not withheld, at the clear's own farm
      const seg = { bitNode: 12, startedAt: '2026-11-11T21:49:50Z', endedAt: '2026-11-12T04:20:00Z', hours: 6.5, sfOnEntry: [[6, 3], [7, 3], [12, 1], [14, 3]], bbJoinH: 0.4, combat100H: 0.3, maxLevel: 500, stalls: [], retrainH: [] }
      let seenGo = 'unset'
      let seenLevel = null
      const R = O.readingsFromSegments([seg, { ...seg, startedAt: '2026-11-12T04:20:00Z' }], { gOf: () => null, bbLeg: (bn, lv, clear) => ((seenGo = legs[clear]?.go ?? null), (seenLevel = O.nodeLevelOf(bn, lv)), 5), gymDiff: () => 0, earlyOf: () => 0, clearLegs: legs })
      c.examined(1)
      if (!R.some((o) => o.param === 'k' && o.clear === 'BN12.2')) c.fail(`BN12.2's k was not read: ${JSON.stringify(R.withheld)}`)
      if (seenGo?.perHour !== 10000) c.fail(`BN12.2's leg was priced at farm ${JSON.stringify(seenGo)}, not its own`)
      if (seenLevel !== 2) c.fail(`BN12.2's leg was priced at level ${seenLevel}, want 2`)
      const specs = O.clearLegSpecs([seg, { ...seg, startedAt: '2026-11-12T04:20:00Z' }], legs)
      if (!specs.some((s) => s.node === 12 && s.level === 2 && s.go?.perHour === 10000)) c.fail(`clearLegSpecs does not build BN12.2's leg at level 2 with its farm: ${JSON.stringify(specs)}`)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
    checks.push(c)
  }

  {
    const c = new Check('BN5', 'THE ANCHOR: A = measured / r(level); the price A x r(L); the leave-one-out of each anchor from the others')
    const r = (L) => 10 * Math.pow(1.05, L)
    const fit = B.bladeAnchorOf([{ label: 'a', level: 0, hours: 6 }, { label: 'b', level: 2, hours: 6 * 1.05 * 1.05 * 1.1 }], r)
    c.examined(2)
    const A = Math.exp((Math.log(0.6) + Math.log(0.66)) / 2)
    if (!fit || Math.abs(fit.A - A) > 1e-9) c.fail(`A ${fit?.A}, want ${A}`)
    if (Math.abs(fit.priceOf(10) - A * r(10)) > 1e-9) c.fail('priceOf(L) is not A x r(L)')
    if (fit.loo.length !== 2 || Math.abs(fit.loo[0].predicted - +(0.66 * r(0)).toFixed(3)) > 1e-9) c.fail(`leave-one-out ${JSON.stringify(fit.loo)}`)
    if (B.bladeAnchorOf([], r) !== null) c.fail('no anchors must price nothing (null), never a default scale')
    checks.push(c)
  }

  {
    const c = new Check('BN6', "THE RUN RECORD: node-entry's planEstimate and the node-plan event take only a plan decided in this node")
    const T = await import('../telrecord.mjs')
    const reset = Date.parse('2026-11-12T00:00:00Z')
    const d = { at: '2026-11-12T00:01:00Z', bitNode: 12, lastNodeReset: reset, sourceFiles: { data: [[12, 2]] } }
    const stale = { node: 12, decidedAt: '2026-11-11T23:59:00Z', exit: { meanH: 0.03 } }
    const mine = { node: 12, decidedAt: '2026-11-12T00:00:30Z', exit: { meanH: 7 } }
    c.examined(2)
    if (T.nodeEntryRow(d, null, stale).planEstimate !== null) c.fail('node-entry took the previous clear\'s plan (decided before the entry) as its estimate')
    if (T.nodeEntryRow(d, null, mine).planEstimate?.meanH !== 7) c.fail('node-entry dropped a plan decided in the node')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bn12tr-'))
    try {
      const rr = new T.RunRecorder({ dir, root: dir })
      rr.onDigest({ ...d })
      rr.onTelFiles({ 'plan.txt': JSON.stringify(stale) }, reset + 60e3)
      rr.onTelFiles({ 'plan.txt': JSON.stringify(mine) }, reset + 120e3)
      const ev = T.readJsonl(path.join(dir, 'events.jsonl')).filter((e) => e.kind === 'node-plan')
      c.examined(ev.length)
      if (ev.length !== 1 || ev[0].exit?.meanH !== 7) c.fail(`node-plan events ${JSON.stringify(ev.map((e) => e.exit))}: want exactly the plan decided in the node (meanH 7)`)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
    checks.push(c)
  }
  {
    const c = new Check('BN7', "THE FLEET MEMO IS THIS LIFE'S: sleeve.js never serves another node's (or life's) Bladeburner fleet — BN12.2 opened on BN15.2's eight-gym fleet from 2026-11-04")
    const S = await import('../../sleeve.js')
    const a = { currentNode: 15, lastNodeReset: 1794154861241, lastAugReset: 1794200000000 }
    const b = { currentNode: 12, lastNodeReset: 1794433790104, lastAugReset: 1794433790104 }
    const memo = { life: S.bladeLifeOf(a), key: 'x', at: 0, result: { config: { infiltrate: 0, support: 0, fa: 0, gym: 8 } }, capped: true }
    c.examined(3)
    if (S.bladeLifeOf(a) === S.bladeLifeOf(b) || S.bladeLifeOf(b) === S.bladeLifeOf({ ...b, lastAugReset: b.lastAugReset + 1 })) c.fail('bladeLifeOf does not tell nodes or installs apart')
    if (S.bladeMemoOf(memo, S.bladeLifeOf(b)) !== null) c.fail("bladeMemoOf served BN15.2's fleet memo in BN12.2")
    if (S.bladeMemoOf(memo, S.bladeLifeOf(a)) !== memo) c.fail("bladeMemoOf refused the memo of its own life")
    const src = code('sleeve.js')
    const fn = src.slice(src.indexOf('async function bladeFleetNow'), src.indexOf('// Module scope stays side-effect free'))
    // every memo READ inside the fleet search goes through this life's memo, never the raw module state
    const raw = fn.match(/bladeMemo\??\.(result|key|at|capped)/g) ?? []
    if (raw.length) c.fail(`bladeFleetNow reads the module memo directly (${raw.join(', ')}): another life's answer can be served`)
    if (!/const key = `\$\{life\}\|/.test(fn)) c.fail("the fleet memo's key does not carry the life")
    checks.push(c)
  }
  return checks
}
