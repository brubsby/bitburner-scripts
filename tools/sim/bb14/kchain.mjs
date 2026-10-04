// THE RANK CALIBRATION k, REPLAYED PASS BY PASS: v2 (one path from each window's
// opening state) against v3 (bbplan.rankCalStep: segments, each from the pass's
// own state as read, black ops apart).
//
//   node tools/sim/bb14/kchain.mjs <capDir> [--policy v1|cur] [--from ISO] [--to ISO]
//
// capDir: the recorder's captures (tools/sim/bbcal14/recorder.mjs; with go.txt
// added for the live run of 2026-10-04 20:29Z on, /tmp/rk3/cap). Each plan pass
// is rebuilt as progress.js bladeRouteOf builds it: bladeStartOf from the
// pass's /tel/bladeburner.txt, the nearest earlier save's player (its LEVEL
// mults with the node's), the fleet and the Go farm's channel the plan
// priced (decisions.bladeRoute.sleeves / start.goCombat), the success
// calibration it applied; the rank path at rankScale 1. --policy: the
// daemon's policy then (v1 before the 0149710 deploy, ~15:12Z 2026-10-04).
//
// NOT CALIBRATED: the person is the save's (5-min cadence, up to a pass
// behind the plan's own read); the fleet source is the plan's published one.
import '../../test/gameresolve.mjs'
import { passesOf, levelled } from '../bbcal14.mjs'
const BB = await import('bbplan.js')
const { bitNodeMults } = await import('bitNodeMultipliers.js')

const argv = process.argv.slice(2)
const arg = (k, d = null) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d)
const POLICY_SWITCH = '2026-10-04T15:12:00Z'

/** The pass's start (bladeRouteOf's inputs) and whether its window may run (acting, rankWindowOkOf). */
export function passStateOf(p, { policy = 'auto' } = {}) {
  const tel = p.tel
  const br = p.plan?.decisions?.bladeRoute ?? {}
  const NM = bitNodeMults(tel?.bitNode ?? 14)
  const P = p.save?.player
  if (!tel || !P) return null
  const person = { skills: P.skills, exp: P.exp, mults: levelled(P.mults) }
  const gc = br.start?.goCombat
  const goCombat = gc && Number.isFinite(gc.effect) ? { effect: gc.effect, nodes: gc.nodes, perHour: gc.perHour, goPower: gc.goPower, sf14: gc.sf14 } : null
  const at = tel.at
  const v1 = policy === 'v1' || (policy === 'auto' && at < POLICY_SWITCH)
  const successScale = br.calibration?.success?.applied ?? 1
  const s0 = BB.bladeStartOf({ tel, person, sleeves: br.sleeves ?? {}, gymExpPerSec: br.start?.gymExpPerSec, bnRank: NM.BladeburnerRank, skillCostMult: NM.BladeburnerSkillCost, rankScale: 1, successScale, goCombat, policy: v1 ? BB.POLICY_V1 ?? null : null, now: Date.parse(at) })
  const ours = tel.joined === true && tel.slot?.ours === true && (tel.result === 'acting' || tel.result === 'started')
  const win = BB.rankWindowOkOf({ tel, fleetSource: br.fleet?.source ?? null })
  return { at, rank: tel.rank, blackOps: tel.blackOps?.done ?? 0, lastAugReset: tel.lastAugReset ?? p.plan?.lastAugReset ?? null, s0, ours, full: win.ok, why: win.why, successScale, bnRank: NM.BladeburnerRank, published: br.calibration?.rank ?? null }
}

/** v3 (rankCalStep as shipped) and v2 (one 3h path at 900s from each window's opening pass) over the passes. */
export function replay(states) {
  let led = null
  const v3 = []
  const v2 = []
  let open2 = null
  for (const s of states) {
    const path3 = s.ours && s.full ? BB.bladeExit({ ...s.s0, maxH: BB.RANK_CAL.pathH, pathEveryS: BB.RANK_CAL.pathEveryS }).path : null
    led = BB.rankCalStep(led, { at: s.at, lastAugReset: s.lastAugReset, rank: s.rank, ours: s.ours, full: s.full, path: path3, successScale: s.successScale, blackOps: s.blackOps, bnRank: s.bnRank })
    if (led.closed) v3.push(led.closed)
    // v2
    if (open2 && (!s.ours || !s.full || open2.lastAugReset !== s.lastAugReset)) open2 = null
    if (open2) {
      const e = (Date.parse(s.at) - Date.parse(open2.at)) / 3.6e6
      if (e >= BB.RANK_CAL.windowH) {
        if (e <= 2.5) {
          const pred = BB.rankOnPath(open2.path, e) - open2.rank
          const real = s.rank - open2.rank
          if (pred > 0 && real > 0) v2.push({ at: open2.at, to: s.at, h: +e.toFixed(3), pred: +pred.toFixed(2), real: +real.toFixed(2), lnK: +Math.log(real / pred).toFixed(4) })
        }
        open2 = null
      }
    }
    if (!open2 && s.ours && s.full) open2 = { at: s.at, rank: s.rank, lastAugReset: s.lastAugReset, path: BB.bladeExit({ ...s.s0, maxH: 3, pathEveryS: 900 }).path }
  }
  return { v3, v2, pending: led?.pending ? { at: led.pending.at, h: +led.pending.h.toFixed(3), segs: led.pending.segs, pred: +led.pending.pred.toFixed(2), real: +led.pending.real.toFixed(2) } : null }
}

if (/tools\/sim\/bb14\/kchain\.mjs$/.test(process.argv[1] ?? '')) {
  const dirs = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')))
  // --windowH: a shorter window to read a stretch under an hour (the shipped definition is RANK_CAL.windowH).
  if (arg('--windowH')) BB.RANK_CAL.windowH = Number(arg('--windowH'))
  const from = arg('--from', '')
  const to = arg('--to', '9999')
  const states = []
  for (const d of dirs) for (const p of passesOf(d)) {
    const s = passStateOf(p, { policy: arg('--policy', 'auto') })
    if (s && s.at >= from && s.at <= to) states.push(s)
  }
  states.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  console.log(`${states.length} passes ${states[0]?.at} .. ${states.at(-1)?.at}; window-eligible ${states.filter((s) => s.ours && s.full).length}`)
  const r = replay(states)
  for (const [name, W] of [['v2 (one path from the opening state)', r.v2], ['v3 (segments from each state as read)', r.v3]]) {
    console.log(`== ${name}: ${W.length} window(s)`)
    for (const w of W) console.log(`   ${w.at.slice(11, 19)}-${w.to.slice(11, 19)} ${w.h}h${w.segs ? ` ${w.segs} segs` : ''}  pred ${w.pred} real ${w.real}  ln k ${w.lnK}`)
    const post = BB.rankRatePosterior(W.map((w) => ({ ...w, v: BB.RANK_CAL.v })))
    console.log(`   posterior: ${post.why}`)
  }
  if (r.pending) console.log(`   v3 open: ${JSON.stringify(r.pending)}`)
  process.exit(0)
}
