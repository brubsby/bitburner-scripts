// [GF] GO FIRST: go.js in a node where Go is strong, and the opponent it plays
// before the planner exists.
//
// Live BN14.1 (2026-10-03, the IPvGO node, GoPower x4, entered ~18:45Z): go.js
// did not run for the first 17 minutes (boot.js admits it at the 128GB home
// tier, home was 32GB). Once the lead ran it by hand it played Daedalus with
// "no derived channel weights ... the incumbent stands (goWeights: gate is
// from another life)": progress.js cannot run at 32GB, so the only gate on
// home was BitNode 4's. Fixture: tools/test/fixture-bn14-gofirst.json, the
// live telemetry at 19:09Z, trimmed to the fields this code reads.
//
//   GF1  goFirstOf: effective Go power = GoPower x (SF14 ? 2 : 1); Go-first at >= 4 (BitNode 14 with or
//        without SF14), not SF14 alone, never on an unknown node
//   GF2  weightsFor: a gate from THIS life with goWeights is used as published (same pick as before); another
//        life's gate, no gate, or a refusing pass -> the early-game weights, never "the incumbent stands"
//   GF3  FRESH NODE (no Bladeburner division, the hacking worker's income only): picks a money opponent
//        (a channel on the income streams), never Daedalus with no faction work, on every Thompson draw
//   GF4  the live BN14.1 state through go.js main(): early weights, the readings it took, and the pick.
//        The Bladeburner route is presumed (the division exists, act.js trains to the 100 bar): Tetrads.
//        Without the division: the hacknet income dominates -> Netburners. With faction work: Daedalus priced.
//   GF5  placement (goPlacementOf / goHomeRepairOf) keeps act.js's WHOLE action slot (live 18:59-20:49Z:
//        go.js on the 32GB home starved every actor): the 32GB opening never takes home (blocked by name
//        with only 16GB hosts); an empty 32GB 'go-host' server is taken; the live 19:08Z home cannot be
//        repaired in place; relocation only when it alone frees the block; 64GB -> a fleet host; BN4 -> wait
//   GF6  seed.js placeGo on a mock game: the opening -> go-host, home untouched; the live shape -> go.js
//        moved off home WITH its args (the user's pin); nowhere to go -> left playing; BN4 untouched
//   GF7  watchdog.js on a mock game in BitNode 14 at 64GB: go.js reserved on a fleet host, seed workers
//        evicted, placed there; in BitNode 4 it stays home-only, as before
//   GF8  go.js OFF HOME: the request reaches home's /go/req.txt, the reply is read from home's /go/move.txt,
//        and /tel/go.txt is published on home (every move answered by the solver, none on the fallback)
//   GF9  the healthcheck: GO NOT PLAYING IN A GO NODE after 10 min absent or idle, from the life's start
//        when go.txt is another life's; not in BitNode 4, not in a young life, not across a restart
//   GF10 the copies: RAISED['go.js'] = go.js's price; every act-*.js is listed; the slot go.js keeps is
//        boot.js's action slot; boot.js's spawn keeps the slot; boot.js never stops a running go.js below
//        its tier (live 20:50Z); --pin and /go/pin.txt hold the opponent until goWeights exist

import './gameresolve.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { Check } from './harness.mjs'
import { REPO_ROOT } from './gameresolve.mjs'

const GP = await import('goplan.js')
const RP = await import('raiseplace.js')
const BN = await import('bitNodeMultipliers.js')
const SRC = (f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8')
const F = JSON.parse(SRC('tools/test/fixture-bn14-gofirst.json'))

const MONEY = new Set(['hacking_speed', 'hacking_money', 'hacknet_node_money'])
const n14 = BN.bitNodeMults(14)
const BN14_INFO = { currentNode: 14, lastAugReset: F.reset.lastAugReset, ownedSF: new Map(F.reset.ownedSF), ownedAugs: new Map(), bitNodeOptions: {} }

/** mulberry32 */
function rng32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** chooseOpponent as go.js calls it at a fresh life: every opponent at n = 0, streak 0, BN14's GoPower. */
const pickOn = (weights, o = {}) =>
  GP.chooseOpponent({
    weights,
    windowH: GP.EARLY.windowH,
    incumbent: o.incumbent ?? 'Daedalus',
    nodePower: Object.fromEntries(Object.keys(GP.OPPONENTS).map((k) => [k, 0])),
    dwellH: 5 / 60,
    dwellGames: 5,
    streaks: Object.fromEntries(Object.keys(GP.OPPONENTS).map((k) => [k, 0])),
    boardSize: 5,
    goPower: n14.GoPower,
    sf14: 0,
    ...(o.winRates ? { winRates: o.winRates } : {}),
  })

/** The fixture's /tel records, re-stamped to `now` so freshness reads as it did live. */
function liveFiles(now = Date.now(), drop = []) {
  const shift = (r) => (r && r.at ? { ...r, at: new Date(now - (Date.parse(F.captured) - Date.parse(r.at))).toISOString() } : r)
  const files = new Map([
    ['/tel/status.txt', shift(F.status)],
    ['/tel/hacknet.txt', shift(F.hacknet)],
    ['/tel/act.txt', shift(F.act)],
    ['/tel/bladeburner.txt', shift(F.bladeburner)],
    ['/tel/bb-lite.txt', shift(F.bbLite)],
    ['/tel/plan.txt', F.plan],
    ['/tel/installgate.txt', F.installgate],
  ])
  for (const d of drop) files.delete(d)
  return new Map([...files].map(([k, v]) => [k, JSON.stringify(v)]))
}

/** go.js main() on a mock game for `games` games; returns the published /tel/go.txt and the boards played. */
async function runGo({ files, info = BN14_INFO, host = 'home', games = 1, answer = true, flags = {} }) {
  const go = await import('go.js')
  // Per-host file maps: ns.read/ns.write are LOCAL, ns.scp copies (the C10 shape).
  const fs_ = { home: files, [host]: host === 'home' ? files : new Map() }
  const resets = []
  let finished = 0
  let answered = 0
  const B = Array.from({ length: 5 }, () => '.....')
  const solve = () => {
    // The external solver: reads HOME's request, answers into HOME's /go/move.txt.
    const q = fs_.home.get('/go/req.txt')
    if (!answer || !q) return
    const r = JSON.parse(q)
    const prev = JSON.parse(fs_.home.get('/go/move.txt') || '{}')
    if (prev.seq === r.seq) return
    const [x, y] = r.valid?.[0] ?? [0, 0]
    fs_.home.set('/go/move.txt', JSON.stringify({ seq: r.seq, x, y }))
    answered++
  }
  const ns = {
    flags: () => ({ size: 5, maxms: 2, idle: 0, topk: 4, remotems: 3000, games, opponent: 'Daedalus', pin: false, ...flags }),
    disableLog() {},
    tprint() {},
    print() {},
    getResetInfo: () => info,
    getHostname: () => host,
    scp: (file, dst, src = host) => {
      const v = fs_[src]?.get(file)
      if (v === undefined) return false
      fs_[dst].set(file, v)
      if (dst === 'home') solve()
      return true
    },
    read: (f) => fs_[host].get(f) ?? '',
    fileExists: () => false,
    atExit() {},
    write: (f, data, mode) => {
      fs_[host].set(f, mode === 'a' ? (fs_[host].get(f) ?? '') + data : data)
      if (host === 'home') solve()
    },
    sleep: () => new Promise((r) => setTimeout(r, 0)),
    exec: () => 0,
    isRunning: () => false,
    go: {
      analysis: { getStats: () => ({}), getValidMoves: () => Array.from({ length: 5 }, () => new Array(5).fill(true)) },
      resetBoardState: (who, size) => resets.push([who, size]),
      getGameState: () => ({ komi: 5.5, blackScore: 20, whiteScore: 5.5 }),
      getBoardState: () => B,
      makeMove: () => {
        finished++
        return Promise.resolve({ type: 'gameOver' })
      },
      passTurn: () => {
        finished++
        return Promise.resolve({ type: 'gameOver' })
      },
    },
  }
  await Promise.race([go.main(ns), new Promise((_, rej) => setTimeout(() => rej(new Error('go.js main() did not finish in 60s')), 60000))])
  return { tel: JSON.parse(fs_.home.get('/tel/go.txt') ?? 'null'), resets, answered, home: fs_.home, local: fs_[host] }
}

export async function run() {
  const checks = []

  // ---- GF1 -------------------------------------------------------------------
  {
    const c = new Check('GF1', 'Go-first: effective Go power >= 4 (BitNode 14, with or without SF14); not SF14 alone; never on an unknown node')
    const cases = [
      [{ goPower: 4, sf14: 0 }, true, 'BN14.1'],
      [{ goPower: 4, sf14: 1 }, true, 'BN14 with SF14'],
      [{ goPower: 1, sf14: 1 }, false, 'another node with SF14'],
      [{ goPower: 1, sf14: 3 }, false, 'another node with SF14.3'],
      [{ goPower: 1, sf14: 0 }, false, 'BN1'],
      [{ goPower: undefined, sf14: 0 }, false, 'unknown node'],
    ]
    for (const [inp, want, tag] of cases) {
      c.examined(1)
      const v = RP.goFirstOf(inp)
      if (v.goFirst !== want) c.fail(`GF1 ${tag}: goFirst ${v.goFirst}, want ${want}`, v.why)
    }
    if (RP.goFirstOf({ goPower: undefined }).effective !== null) c.fail('GF1 an unknown node must say unknown (effective null), not 0')
    if (n14?.GoPower !== 4) c.fail(`GF1 the BitNode table says GoPower ${n14?.GoPower} for BN14 (game: 4, BitNode.tsx:1042)`)
    for (const n of [1, 2, 4, 5, 6, 8, 9, 10]) {
      c.examined(1)
      if (RP.goFirstOf({ goPower: BN.bitNodeMults(n)?.GoPower, sf14: 0 }).goFirst) c.fail(`GF1 BitNode ${n} reads as Go-first`)
    }
    c.note(RP.goFirstOf({ goPower: 4, sf14: 0 }).why)
    checks.push(c)
  }

  // ---- GF2 -------------------------------------------------------------------
  {
    const c = new Check('GF2', "weightsFor: this life's goWeights as published; anything else -> the early-game weights, never 'the incumbent stands'")
    const LAR = 1234
    const gw = { weights: { faction_rep: 3, hacking_speed: 0.1, hacking_money: 0.02, hacknet_node_money: 0 }, windowH: 6, why: null }
    const thisLife = { lastAugReset: LAR, objective: { goWeights: gw, windowH: 6 } }
    let inputsRead = 0
    const inputs = () => {
      inputsRead++
      return { hackIncome: 18, hacknetIncome: null, work: null, blade: { open: false } }
    }
    c.examined(4)
    const a = GP.weightsFor(thisLife, LAR, inputs)
    if (a.source !== 'goWeights' || a.weights !== gw.weights || a.windowH !== 6) c.fail('GF2 a this-life gate with goWeights must be used exactly as published', JSON.stringify(a))
    if (inputsRead !== 0) c.fail('GF2 the early readings must not be taken when goWeights exist')
    // Same pick as handing chooseOpponent the goWeights directly (the pre-fallback path).
    const direct = pickOn(gw.weights)
    const via = pickOn(a.weights)
    if (direct.opponent !== via.opponent || direct.opponent !== 'Daedalus') c.fail(`GF2 deferring to goWeights changed the pick: ${direct.opponent} vs ${via.opponent}`)
    const b = GP.weightsFor({ ...thisLife, lastAugReset: LAR - 1 }, LAR, inputs)
    if (b.source !== 'early' || b.gwWhy !== 'gate is from another life') c.fail('GF2 another life\'s gate must fall to the early weights', JSON.stringify(b))
    const d = GP.weightsFor(null, LAR, inputs)
    if (d.source !== 'early' || d.gwWhy !== 'no gate') c.fail('GF2 no gate must fall to the early weights', JSON.stringify(d))
    const e = GP.weightsFor({ lastAugReset: LAR, objective: { goWeights: { weights: null, why: 'exit inputs are stale (>15 min)' } } }, LAR, inputs)
    if (e.source !== 'early' || !/stale/.test(e.gwWhy)) c.fail('GF2 a refusing pass this life must fall to the early weights, carrying its reason', JSON.stringify(e))
    // The live gate (BitNode 4's) is from another life and its goWeights are not used.
    const live = GP.weightsFor(F.installgate, F.reset.lastAugReset, inputs)
    if (live.source !== 'early') c.fail('GF2 the live BN4 gate was used in BN14', JSON.stringify(live))
    // And chooseOpponent never refuses on the early weights.
    const p = pickOn(live.weights)
    if (p.refused) c.fail('GF2 the early weights were refused', p.why)
    c.note(`live: ${live.why}`)
    checks.push(c)
  }

  // ---- GF3 -------------------------------------------------------------------
  {
    const c = new Check('GF3', 'a FRESH node (no division, the hacking worker\'s income) picks a money opponent on every draw; Daedalus never without faction work')
    const fresh = GP.earlyGoWeights({ hackIncome: 18, hacknetIncome: null, work: null, blade: { open: false }, nodeMults: n14 })
    const unmeasured = GP.earlyGoWeights({})
    for (const [tag, w] of [['$18/s of hack income', fresh], ['no income measured', unmeasured]]) {
      c.examined(1)
      const p = pickOn(w.weights)
      const ch = GP.OPPONENTS[p.opponent]?.channel
      if (!MONEY.has(ch)) c.fail(`GF3 ${tag}: picked ${p.opponent} (${ch}), not a money opponent`, p.why)
      if (w.weights.faction_rep !== 0) c.fail(`GF3 ${tag}: faction_rep weighs ${w.weights.faction_rep} with no faction work`)
      if ('combat' in w.weights) c.fail(`GF3 ${tag}: combat priced with no Bladeburner division`)
      c.note(`${tag}: ${p.opponent} — ${p.why.slice(0, 200)}`)
    }
    // Every Thompson draw from the priors: still a money opponent.
    const rnd = rng32(14)
    const tally = {}
    for (let i = 0; i < 300; i++) {
      c.examined(1)
      const draw = GP.drawWinRates(GP.emptyPosterior(), Object.keys(GP.OPPONENTS), 5, rnd)
      const p = pickOn(fresh.weights, { winRates: draw })
      tally[p.opponent] = (tally[p.opponent] ?? 0) + 1
      if (!MONEY.has(GP.OPPONENTS[p.opponent]?.channel)) {
        c.fail(`GF3 draw ${i}: ${p.opponent} on a fresh node`, p.why)
        break
      }
    }
    c.note(`300 Thompson draws on a fresh node: ${JSON.stringify(tally)}`)
    // The Black Hand vs Illuminati, by the numbers: hacking_money moves only the hack side of a loop.
    const pt = pickOn(fresh.weights).table
    const bh = pt.find((s) => s.name === 'TheBlackHand')
    const il = pt.find((s) => s.name === 'Illuminati')
    c.note(`fresh node at n=0: Illuminati ${il.marginal.toExponential(2)}/h (hacking_speed x${il.weight.toFixed(2)}, ${Math.round(il.powerPerHour)} power/h) vs The Black Hand ${bh.marginal.toExponential(2)}/h (hacking_money x${bh.weight.toFixed(2)}, ${Math.round(bh.powerPerHour)}/h)`)
    // Concavity spreads play: once Illuminati has banked, The Black Hand leads.
    const later = GP.chooseOpponent({ weights: fresh.weights, windowH: 8, incumbent: 'Illuminati', nodePower: { Daedalus: 0, Illuminati: 2e4, TheBlackHand: 0, SlumSnakes: 0, Netburners: 0, Tetrads: 0 }, boardSize: 5, goPower: 4 })
    c.examined(1)
    if (later.opponent !== 'TheBlackHand') c.fail(`GF3 with Illuminati at 20k node power the next money board should be The Black Hand, got ${later.opponent}`, later.why)
    checks.push(c)
  }

  // ---- GF4 -------------------------------------------------------------------
  {
    const c = new Check('GF4', 'the live BN14.1 state through go.js main(): early weights from its readings; the presumed Bladeburner route -> Tetrads; no division -> Netburners; faction work prices Daedalus')
    try {
      const r = await runGo({ files: liveFiles() })
      c.examined(1)
      const t = r.tel
      if (t?.weightsSource !== 'early') c.fail(`GF4 go.txt weightsSource ${t?.weightsSource}, want 'early'`, t?.opponentWhy)
      if (!/early-game weights/.test(t?.opponentWhy ?? '') || /incumbent stands/.test(t?.opponentWhy ?? '')) c.fail('GF4 the choice must name the early weights, not the incumbent', t?.opponentWhy)
      if (t?.opponent !== 'Tetrads') c.fail(`GF4 on the presumed Bladeburner route before the join the pick should be Tetrads, got ${t?.opponent}`, t?.opponentWhy)
      if (!/combat bar 100/.test(t?.earlyWhy ?? '') || !/hacknet/.test(t?.earlyWhy ?? '')) c.fail('GF4 earlyWhy must carry the readings (the combat bar, the income split)', t?.earlyWhy)
      if (t?.bitNode !== 14 || t?.goPower !== 4 || t?.host !== 'home') c.fail('GF4 go.txt must say where and in which node it plays', JSON.stringify({ bitNode: t?.bitNode, goPower: t?.goPower, host: t?.host }))
      c.note(`live state -> ${t?.opponent}: ${String(t?.opponentWhy).slice(0, 320)}`)
      c.note(`readings: ${t?.earlyWhy}`)
    } catch (e) {
      c.fail(`GF4 go.js main() on the live state threw: ${e?.message ?? e}`)
    }
    // Without the division (no SF6/7): the income split decides. Hacknet earns ~98% here.
    {
      c.examined(1)
      const info = { ...BN14_INFO, ownedSF: new Map([...BN14_INFO.ownedSF].filter(([k]) => k !== 6 && k !== 7)) }
      const r = await runGo({ files: liveFiles(), info })
      if (r.tel?.opponent !== 'Netburners') c.fail(`GF4 no division, hacknet ${F.hacknet.moneyPerSec}/s vs hack ${F.status.incomePerSec}/s: want Netburners, got ${r.tel?.opponent}`, r.tel?.opponentWhy)
      else c.note(`no division: Netburners — ${String(r.tel.opponentWhy).slice(0, 200)}`)
    }
    // Faction work is the first batch's leg: faction_rep weighs 1 and Daedalus is priced.
    {
      c.examined(1)
      const w = GP.earlyGoWeights({ hackIncome: 18, hacknetIncome: 0, work: 'faction', blade: { open: false }, nodeMults: n14 })
      const p = pickOn(w.weights)
      if (w.weights.faction_rep !== 1) c.fail(`GF4 faction work must weigh faction_rep 1, got ${w.weights.faction_rep}`)
      if (!p.table.some((s) => s.name === 'Daedalus' && s.marginal > 0)) c.fail('GF4 Daedalus must be priced (> 0) under faction work', p.why)
      c.note(`faction work, hack income only: ${p.opponent} — ${p.why.slice(0, 160)}`)
    }
    checks.push(c)
  }

  // ---- GF5 -------------------------------------------------------------------
  {
    const c = new Check('GF5', "placement keeps act.js's WHOLE action slot: the 32GB opening never takes home (fleet or blocked); go-host taken; the live 19:08Z home cannot be repaired in place; 64GB -> a fleet host; BN4 -> wait")
    const go14 = RP.goFirstOf({ goPower: 4, sf14: 0 })
    const KEEP = 19.4 // act-liquidate.js in BN14: the action slot boot.js reserves
    const NEED = 20.75
    const fleet16 = (n) => Array.from({ length: n }, (_, i) => ({ host: `f${i}`, max: 16, used: 14.4, workerGb: 0, evictGb: 14.4 }))
    // (a) the 32GB opening: early.js x5 on home, only 16GB hosts rooted -> blocked, home untouched.
    {
      c.examined(1)
      const home = { host: 'home', max: 32, used: 12, workerGb: 0, evictGb: 12, relocGb: 0 }
      const d = RP.goPlacementOf({ go: go14, homeMax: 32, need: NEED, homeKeep: KEEP, homeBlock: 0, hosts: [home, ...fleet16(7)] })
      if (d.action !== 'blocked' || d.host === 'home') c.fail('GF5a a 32GB home cannot hold go.js beside the action slot: blocked (by name) until a 32GB host exists', JSON.stringify(d))
      c.note(`32GB opening, 16GB fleet: ${d.why}`)
    }
    // (b) ... plus the purchased 32GB 'go-host' (live 20:50Z): placed there.
    {
      c.examined(1)
      const home = { host: 'home', max: 32, used: 12, workerGb: 0, evictGb: 12, relocGb: 0 }
      const d = RP.goPlacementOf({ go: go14, homeMax: 32, need: NEED, homeKeep: KEEP, homeBlock: 0, hosts: [home, ...fleet16(7), { host: 'go-host', max: 32, used: 0, workerGb: 0, evictGb: 0 }] })
      if (d.action !== 'place' || d.host !== 'go-host') c.fail('GF5b an empty 32GB server must take go.js', JSON.stringify(d))
    }
    // (c) the live 19:08Z home: go.js + hashspend.js on 32GB. Even moving hashspend leaves 11.25GB < 19.4.
    {
      c.examined(2)
      const r = RP.goHomeRepairOf({ max: 32, used: 28, keep: KEEP, procs: [{ script: 'go.js', gb: 20.75 }, { script: 'hashspend.js', gb: 7.25 }] })
      if (r.ok || r.stop.length) c.fail('GF5c the live 32GB home cannot keep the slot beside go.js: nothing stopped, go.js itself must move', JSON.stringify(r))
      const r2 = RP.goHomeRepairOf({ max: 64, used: 20.75 + 7.25 + 28.3, keep: KEEP, procs: [{ script: 'go.js', gb: 20.75 }, { script: 'hashspend.js', gb: 7.25 }, { script: 'early.js', gb: 12 }] })
      if (!r2.ok || !(r2.freeAfter >= KEEP)) c.fail('GF5c a repairable home frees the slot by stopping the worker then relocatables', JSON.stringify(r2))
      c.note(`live 19:08Z: repair in place ${r.ok ? 'possible' : 'impossible'} (go.js 20.75 + slot 19.4 > 32GB) — seed.js moves go.js to the fleet`)
    }
    // (d) relocation only when the block needs it (a synthetic 48GB home with 5GB of non-movable residents).
    {
      c.examined(2)
      const home = { host: 'home', max: 48, used: 7.25 + 4.8 + 5, workerGb: 0, evictGb: 4.8, relocGb: 7.25 }
      const d = RP.goPlacementOf({ go: go14, homeMax: 48, need: NEED, homeKeep: KEEP, homeBlock: 0, hosts: [home, ...fleet16(3)] })
      if (d.action !== 'reserve' || d.host !== 'home' || !d.relocate) c.fail('GF5d hashspend.js must be relocated when only that frees the block', JSON.stringify(d))
      const d2 = RP.goPlacementOf({ go: go14, homeMax: 48, need: NEED, homeKeep: KEEP, homeBlock: 0, hosts: [{ ...home, used: 12.05 }, ...fleet16(3)] })
      if (d2.relocate) c.fail('GF5d nothing is relocated when the worker alone frees the block', JSON.stringify(d2))
    }
    // (e) 64GB with progress.js's block and the 64GB tier's residents: a 32GB fleet host, its seed workers evicted.
    {
      c.examined(1)
      const block = 13 + 6.25
      const hosts = [{ host: 'home', max: 64, used: 28.3 + 9.6, workerGb: 0, evictGb: 9.6 }, { host: 'neo-net', max: 32, used: 31.2, workerGb: 0, evictGb: 31.2 }, ...fleet16(4)]
      const d = RP.goPlacementOf({ go: go14, homeMax: 64, need: NEED, homeKeep: KEEP, homeBlock: block, progressRunning: false, hosts })
      if (d.action !== 'reserve' || d.host !== 'neo-net' || !d.evict) c.fail("GF5e a 64GB home must send go.js to a 32GB fleet host", JSON.stringify(d))
      c.note(`64GB: ${d.why}`)
    }
    // (f) not a Go-first node: nothing.
    {
      c.examined(1)
      const d = RP.goPlacementOf({ go: RP.goFirstOf({ goPower: 1, sf14: 0 }), homeMax: 32, need: NEED, homeKeep: KEEP, hosts: [{ host: 'home', max: 32, used: 0 }] })
      if (d.action !== 'wait' || d.admitted) c.fail('GF5f outside a Go-first node go.js is not placed here', JSON.stringify(d))
    }
    checks.push(c)
  }

  // ---- GF6 -------------------------------------------------------------------
  {
    const c = new Check('GF6', "seed.js placeGo on a mock game: the 32GB opening -> the go-host server, home untouched; the live shape -> go.js moved off home with its pin; BN4 untouched")
    const SEED = await import('seed.js')
    const RAM = { 'go.js': 20.75, 'early.js': 2.4, 'hgw.js': 2, 'hashspend.js': 3.25, 'act-liquidate.js': 19.4, 'act-graft.js': 14, 'act-company.js': 8.25, 'act-gym.js': 4.25 }
    const mock = (hosts, info = BN14_INFO) => {
      const world = { hosts, files: new Map(), execs: [], kills: [] }
      let pid = 1
      const used = (h) => world.hosts[h].procs.reduce((a, p) => a + p.ram * p.threads, 0)
      const ns = {
        getResetInfo: () => info,
        getHostname: () => 'foodnstuff',
        write: (f, d) => world.files.set(f, String(d)),
        read: (f) => world.files.get(f) ?? '',
        scp: () => true,
        hasRootAccess: () => true,
        getServerMaxRam: (h) => world.hosts[h].max,
        getServerUsedRam: (h) => used(h),
        getScriptRam: (s) => RAM[s] ?? 2,
        ps: (h) => world.hosts[h].procs.map((p) => ({ filename: p.filename, threads: p.threads, args: p.args ?? [], pid: p.pid })),
        scriptKill: (s, h) => {
          const n = world.hosts[h].procs.length
          world.hosts[h].procs = world.hosts[h].procs.filter((p) => p.filename !== s)
          if (world.hosts[h].procs.length !== n) world.kills.push(`${s}@${h}`)
          return true
        },
        exec: (s, h, threads = 1, ...args) => {
          const ram = Math.max(RAM[s] ?? 2, RP.RAISED[s] && s !== 'go.js' ? RP.RAISED[s].gb : 0)
          if (world.hosts[h].max - used(h) < ram * threads) return 0
          world.hosts[h].procs.push({ filename: s, threads, ram, args, pid: ++pid })
          world.execs.push({ s: `${s}@${h}`, args })
          return pid
        },
        sleep: async () => {},
        tprint() {},
      }
      return { ns, world, used }
    }
    const p = (filename, ram, threads = 1, args = []) => ({ filename, ram, threads, args })
    // (a) the 32GB opening after boot.js, with the purchased 32GB go-host.
    {
      const g = mock({
        home: { max: 32, procs: [p('early.js', 2.4, 5), p('hashspend.js', 7.25)] },
        foodnstuff: { max: 16, procs: [p('seed.js', 7.8), p('early.js', 2.4, 3)] },
        'sigma-cosmetics': { max: 16, procs: [p('early.js', 2.4, 6)] },
        'go-host': { max: 32, procs: [] },
      })
      const host = await SEED.placeGo(g.ns, Object.keys(g.world.hosts))
      c.examined(2)
      if (host !== 'go-host') c.fail('GF6a go.js must be placed on go-host', JSON.stringify({ host, execs: g.world.execs, kills: g.world.kills }))
      if (g.world.kills.some((k) => k.endsWith('@home'))) c.fail('GF6a nothing on home is touched when home cannot hold go.js beside the slot', JSON.stringify(g.world.kills))
      c.note(`32GB opening + go-host: ${g.world.execs.map((e) => e.s).join(', ')}`)
    }
    // (b) the live shape: go.js (the user's pin) on home with hashspend.js; go-host bought.
    {
      const pin = ['--opponent', 'The Black Hand', '--pin']
      const g = mock({
        home: { max: 32, procs: [p('go.js', 20.75, 1, pin), p('hashspend.js', 7.25)] },
        foodnstuff: { max: 16, procs: [p('seed.js', 7.8), p('early.js', 2.4, 3)] },
        'go-host': { max: 32, procs: [] },
      })
      const host = await SEED.placeGo(g.ns, Object.keys(g.world.hosts))
      c.examined(3)
      const ex = g.world.execs.find((e) => e.s === 'go.js@go-host')
      if (host !== 'go-host' || !ex) c.fail('GF6b go.js must move off home to go-host', JSON.stringify({ host, execs: g.world.execs }))
      else if (JSON.stringify(ex.args) !== JSON.stringify(pin)) c.fail('GF6b the moved go.js must keep its args (the user\'s pin)', JSON.stringify(ex.args))
      if (g.world.hosts.home.procs.some((q) => q.filename === 'go.js')) c.fail('GF6b go.js must be gone from home after the move')
      if (!(32 - g.used('home') >= 19.4)) c.fail(`GF6b home keeps ${32 - g.used('home')}GB after the move, under the 19.4GB slot`)
    }
    // (b2) the same with no fleet host able to hold it: go.js stays (playing beats nothing), said in lastGo.
    {
      const g = mock({ home: { max: 32, procs: [p('go.js', 20.75)] }, foodnstuff: { max: 16, procs: [p('early.js', 2.4, 6)] } })
      const host = await SEED.placeGo(g.ns, Object.keys(g.world.hosts))
      c.examined(1)
      if (host !== 'home' || g.world.kills.includes('go.js@home')) c.fail('GF6b2 with nowhere to go, go.js is not killed', JSON.stringify(g.world))
    }
    // (c) BitNode 4: placeGo does nothing at all.
    {
      const g = mock({ home: { max: 32, procs: [p('early.js', 2.4, 5)] }, foodnstuff: { max: 16, procs: [] } }, { ...BN14_INFO, currentNode: 4 })
      const host = await SEED.placeGo(g.ns, Object.keys(g.world.hosts))
      c.examined(1)
      if (host !== null || g.world.execs.length || g.world.kills.length) c.fail('GF6c outside a Go-first node seed.js must not touch go.js', JSON.stringify(g.world))
    }
    checks.push(c)
  }

  // ---- GF7 -------------------------------------------------------------------
  {
    const c = new Check('GF7', 'watchdog.js on a mock game: BitNode 14 at 64GB places go.js on a fleet host it reserves; BitNode 4 keeps it home-only')
    const { mockGame, drive, proc, runningOn } = await import('./bbfull.test.mjs')
    const early = (n) => [proc('early.js', 2.4, n)]
    const RAMX = { 'go.js': 20.75, 'act-liquidate.js': 19.4, 'act-company.js': 8.25, 'early.js': 2.4 }
    const patch = (g) => {
      const orig = g.ns.getScriptRam
      g.ns.getScriptRam = (s, h) => RAMX[s] ?? orig(s, h)
      const exec = g.ns.exec
      g.ns.exec = (s, h, t = 1, ...a) => {
        if (s !== 'go.js') return exec(s, h, t, ...a)
        // go.js is not raise-sized: it needs its static price free at launch.
        const used = g.world.hosts[h].procs.reduce((x, p) => x + p.ram * p.threads, 0)
        if (g.world.hosts[h].max - used < 20.75) return 0
        g.world.hosts[h].procs.push({ filename: 'go.js', threads: 1, ram: 20.75, pid: 777 })
        g.world.execs.push({ script: 'go.js', host: h, cycle: g.world.cycle })
        return 777
      }
      return g
    }
    {
      const g = patch(mockGame({ cycles: 3, info: BN14_INFO, files: { '/tel/plan.txt': 'null' }, hosts: { home: { max: 64, procs: [proc('watchdog.js', 9), proc('stack.js', 28.3), ...early(4)] }, 'neo-net': { max: 32, procs: early(13) }, foodnstuff: { max: 16, procs: early(6) } } }))
      const w = await drive(g)
      c.examined(2)
      const on = runningOn(w, 'go.js')
      if (on.length !== 1 || on[0] !== 'neo-net') c.fail(`GF7 BN14 64GB: go.js must run on neo-net (reserved, seed workers evicted), runs on ${JSON.stringify(on)}`, JSON.stringify({ kills: w.kills, execs: w.execs.filter((e) => e.script === 'go.js'), rec: JSON.parse(w.files['/tel/watchdog.txt'] || 'null')?.daemons?.['go.js'] }))
      if (!w.kills.some((k) => k.script === 'early.js' && k.host === 'neo-net')) c.fail('GF7 the seed workers on the reserved host must be evicted', JSON.stringify(w.kills))
      c.note(`BN14 64GB: go.js on ${on}; ${String(JSON.parse(w.files['/tel/watchdog.txt'] || 'null')?.daemons?.['go.js']?.placement?.why ?? '').slice(0, 200)}`)
    }
    {
      const g = patch(mockGame({ cycles: 3, hosts: { home: { max: 64, procs: [proc('watchdog.js', 9), proc('stack.js', 28.3), ...early(4)] }, 'neo-net': { max: 32, procs: early(13) } } }))
      const w = await drive(g)
      c.examined(1)
      const off = w.execs.filter((e) => e.script === 'go.js' && e.host !== 'home')
      if (off.length || w.kills.some((k) => k.host === 'neo-net')) c.fail('GF7 BN4: go.js must stay home-only and evict nothing', JSON.stringify({ off, kills: w.kills }))
    }
    checks.push(c)
  }

  // ---- GF8 -------------------------------------------------------------------
  {
    const c = new Check('GF8', 'go.js OFF HOME: requests reach home, replies are read from home, go.txt is published on home; every move from the solver')
    try {
      const r = await runGo({ files: liveFiles(), host: 'sigma-cosmetics', games: 2 })
      c.examined(3)
      if (!(r.answered > 0)) c.fail('GF8 the solver (on home) never saw a request from the off-home go.js')
      if (!(r.tel?.remoteMoves > 0) || r.tel?.localMoves !== 0) c.fail(`GF8 remote ${r.tel?.remoteMoves} / local ${r.tel?.localMoves}: every move must come from the solver`)
      if (r.tel?.host !== 'sigma-cosmetics') c.fail('GF8 /tel/go.txt must be on home and name the host it plays from', JSON.stringify({ host: r.tel?.host }))
      c.note(`off home on sigma-cosmetics: ${r.tel?.remoteMoves} solver moves, ${r.tel?.localMoves} fallback, ${r.answered} requests answered on home`)
    } catch (e) {
      c.fail(`GF8 go.js off home threw: ${e?.message ?? e}`)
    }
    checks.push(c)
  }

  // ---- GF9 -------------------------------------------------------------------
  {
    const c = new Check('GF9', 'GO NOT PLAYING IN A GO NODE after 10 min absent or idle; not in BitNode 4, not in a young life, not across a restart')
    const { goNodeHealth, sfOfState } = await import('../gohealth.mjs')
    const now = Date.parse('2026-10-03T19:30:00Z')
    const v14 = RP.goFirstOf({ goPower: 4, sf14: 0 })
    const v4 = RP.goFirstOf({ goPower: 1, sf14: 0 })
    const st = (lifeMin) => ({ bitNode: 14, sourceFiles: F.state.sourceFiles, playtimeSinceLastAug: lifeMin * 60e3 })
    const goRec = (minAgo, extra = {}) => ({ at: new Date(now - minAgo * 60e3).toISOString(), health: 'ok', remoteMoves: 50, localMoves: 0, processStartedAt: '2026-10-03T19:03:25Z', opponent: 'TheBlackHand', host: 'home', ...extra })
    const cases = [
      ['BN14, 30-min life, go.txt from the last node', { state: st(30), go: { ...goRec(60), at: '2026-10-03T18:40:00Z' } }, true],
      ['BN14, 30-min life, no go.txt', { state: st(30), go: null }, true],
      ['BN14, 5-min life, no go.txt', { state: st(5), go: null }, false],
      ['BN14, playing (fresh heartbeat)', { state: st(30), go: goRec(1) }, false],
      ['BN14, stopped 15 min ago', { state: st(30), go: goRec(15, { health: 'stopped', exited: true }) }, true],
      ['BN14, heartbeat 15 min stale', { state: st(30), go: goRec(15) }, true],
      ['BN4, no go.txt', { state: { ...st(30), bitNode: 4 }, go: null, verdict: v4 }, false],
      ['BN14, idle 12 min, same process', { state: st(30), go: goRec(1), prev: { bitNode: 14, at: now - 12 * 60e3, moves: 50, since: null, proc: '2026-10-03T19:03:25Z' } }, true],
      ['BN14, moves counted afresh after a restart', { state: st(30), go: goRec(1, { remoteMoves: 3, processStartedAt: '2026-10-03T19:25:00Z' }), prev: { bitNode: 14, at: now - 12 * 60e3, moves: 50, since: null, proc: '2026-10-03T19:03:25Z' } }, false],
      ['BN14, moving since the last sample', { state: st(30), go: goRec(1, { remoteMoves: 80 }), prev: { bitNode: 14, at: now - 12 * 60e3, moves: 50, since: null, proc: '2026-10-03T19:03:25Z' } }, false],
    ]
    for (const [tag, o, want] of cases) {
      c.examined(1)
      const r = goNodeHealth({ verdict: v14, nowMs: now, ...o })
      if (!!r.fail !== want) c.fail(`GF9 ${tag}: ${r.fail ? 'FAILED' : 'passed'}, want ${want ? 'FAIL' : 'pass'}`, JSON.stringify(r))
      else if (r.fail) c.note(`${tag}: ${r.fail.what}`)
    }
    if (sfOfState(F.state, 6) !== 1 || sfOfState(F.state, 14) !== 0) c.fail('GF9 sfOfState misreads the save digest\'s Source-Files')
    const hc = SRC('tools/healthcheck.mjs')
    c.examined(1)
    if (!/goNodeHealth\(\{[^}]*prev: prev\?\.goNode/.test(hc) || !/now\.goNode = r\.snap/.test(hc)) c.fail('GF9 healthcheck.mjs must run goNodeHealth with the previous snapshot and save this one')
    checks.push(c)
  }

  // ---- GF10 ------------------------------------------------------------------
  {
    const c = new Check('GF10', "the copies: RAISED['go.js'] = go.js's price; every act-*.js ROUTINE or RARE; go.js + headroom fits 32GB; boot.js keeps the action slot at the spawn; --pin holds")
    // The game's RAM calculator needs esbuild, which a mutant sandbox has not
    // got: there the priced checks are skipped LOUDLY (a WARN) and the rest run.
    let R = null
    try {
      R = await import('./ram.mjs')
      await R.load()
      R.asSave({ bitNode: 14, sf: Object.fromEntries(F.reset.ownedSF) })
    } catch (e) {
      c.warn('GF10 the RAM calculator did not load — the priced checks did not run', String(e?.message ?? e).slice(0, 160))
      R = { ramOf: (s) => ({ cost: { 'go.js': 20.75, 'act-liquidate.js': 19.4, 'boot.js': 6.4 }[s] ?? 2 }) }
    }
    const goRam = R.ramOf('go.js')?.cost
    c.examined(1)
    if (goRam !== RP.RAISED['go.js'].gb) c.fail(`GF10 RAISED['go.js'].gb ${RP.RAISED['go.js'].gb} vs go.js priced ${goRam}GB in BN14`)
    const actors = fs.readdirSync(REPO_ROOT).filter((f) => /^act-.*\.js$/.test(f))
    c.examined(actors.length)
    for (const a of actors) if (!RP.ROUTINE_ACTORS.includes(a) && !RP.RARE_ACTORS.includes(a)) c.fail(`GF10 ${a} is in neither ROUTINE_ACTORS nor RARE_ACTORS — decide whether go.js keeps room for it on home`)
    for (const a of [...RP.ROUTINE_ACTORS, ...RP.RARE_ACTORS]) if (!actors.includes(a)) c.fail(`GF10 ${a} is listed and does not exist`)
    const keep = RP.goHomeKeepOf((a) => R.ramOf(a)?.cost ?? 0)
    // The slot go.js keeps on home IS boot.js's action slot: the largest act-*.js.
    const slot = Math.max(...actors.map((a) => R.ramOf(a)?.cost ?? 0))
    if (keep !== slot) c.fail(`GF10 goHomeKeepOf ${keep}GB is not boot.js's action slot ${slot}GB (the largest act-*.js)`)
    c.note(`BN14: go.js ${goRam}GB + the ${keep}GB action slot = ${(goRam + keep).toFixed(2)}GB: ${goRam + keep > 32 ? 'not on a 32GB home — the fleet is the path' : 'fits a 32GB home'}; at 64GB with the tier's residents (28.3GB) and progress.js's block it does not fit either`)
    for (const s of ['seed.js', 'watchdog.js', 'go.js', 'boot.js']) c.note(`${s} ${R.ramOf(s)?.cost}GB in BN14`)
    const boot = SRC('boot.js')
    c.examined(1)
    if (!/const room = spare\(ns, 'home'\) \+ costOf\('boot\.js'\) - plan\.action/.test(boot)) c.fail("GF10 boot.js's worker spawn must hold back the action slot from the MEASURED room")
    // boot.js never stops a running go.js below its tier (live 20:50Z: home 64GB, go.js stopped).
    {
      c.examined(1)
      const { planStack, MIN_OPS } = await import('stack.js')
      const open = boot.indexOf('[', boot.indexOf('const STACK = ['))
      let depth = 0
      let STACK = null
      for (let i = open; i < boot.length; i++) {
        if (boot[i] === '[') depth++
        else if (boot[i] === ']' && --depth === 0) {
          STACK = new Function(`return ${boot.slice(open, i + 1)}`)()
          break
        }
      }
      const goEntry = STACK.find((e) => e.script === 'go.js')
      const plan = planStack(STACK, { homeRam: 64, costOf: (s) => R.ramOf(s)?.cost ?? 0, bootRam: R.ramOf('boot.js')?.cost, minOps: MIN_OPS, actionRam: slot })
      const deferred = plan.defer.some((e) => e.script === 'go.js')
      if (!deferred) c.note('go.js is admitted at 64GB in this regime (the keep-if-running rule is then moot)')
      if (goEntry?.keepIfRunning !== true || !/entry\.keepIfRunning\) continue/.test(boot)) c.fail('GF10 boot.js must leave a running go.js alone when its tier defers it (keepIfRunning)')
    }
    // --pin: The Black Hand holds while the weights are the early heuristic ...
    try {
      const r = await runGo({ files: liveFiles(), games: 6, flags: { pin: true, opponent: 'The Black Hand' } })
      c.examined(1)
      if (!r.resets.length || !r.resets.every(([who]) => who === 'The Black Hand') || !/pinned/.test(r.tel?.opponentWhy ?? '')) c.fail('GF10 --pin must hold --opponent while there are no goWeights', JSON.stringify({ resets: r.resets.slice(0, 7), why: r.tel?.opponentWhy }))
      // ... and through a relaunch with no args, from /go/pin.txt.
      const files = liveFiles()
      files.set('/go/pin.txt', 'The Black Hand\n')
      const r2 = await runGo({ files, games: 3 })
      c.examined(1)
      if (!r2.resets.every(([who]) => who === 'The Black Hand')) c.fail('GF10 /go/pin.txt must pin a relaunched go.js', JSON.stringify(r2.resets))
      // ... until this life's goWeights exist: then they price (Daedalus on faction_rep here).
      const f3 = liveFiles()
      f3.set('/tel/installgate.txt', JSON.stringify({ lastAugReset: BN14_INFO.lastAugReset, objective: { goWeights: { weights: { faction_rep: 5, hacking_speed: 0, hacking_money: 0, hacknet_node_money: 0 }, windowH: 6 } } }))
      const r3 = await runGo({ files: f3, games: 1, flags: { pin: true, opponent: 'The Black Hand' } })
      c.examined(1)
      if (r3.tel?.weightsSource !== 'goWeights' || r3.tel?.opponent !== 'Daedalus') c.fail('GF10 a pin yields to this life\'s goWeights', JSON.stringify({ src: r3.tel?.weightsSource, opp: r3.tel?.opponent, why: r3.tel?.opponentWhy }))
    } catch (e) {
      c.fail(`GF10 pin runs threw: ${e?.message ?? e}`)
    }
    checks.push(c)
  }

  return checks
}
