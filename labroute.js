// THE LABYRINTH ROUTE AS A PRICED ARM (BitNode 15). Pure: no ns calls (imported by progress.js and plan.js's
// callers, tools/healthcheck.mjs, tools/sim/lab15.mjs; free).
//
// WHAT IT PRICES. In BitNode 15 The Red Pill is the 5th darknet labyrinth's reward (labyrinth.ts:419-427), each
// lab after the previous one's augmentation is INSTALLED, at charisma 300 / 600 / 1500 / 2500 / 3000. The route
// is the hacking route (its lives, its installs, its final climb to w0r1d_d43m0n) with the labs riding on its
// lives: the heartbleed farm (dnet-cha.js) and the crawler / walker (dnet.js, dnet-lab.js) are scripts on free
// RAM — no work slot — so a lab costs the route only (a) the install it forces when it clears before the life's
// own install (dnetplan.labInstallOf: chaplan.LAB_INSTALL_H each) and (b) the hours a climb is HELD past the
// last life before the final window. Both come out of chaplan.labScheduleOf on a LIFE TRAJECTORY.
//
// THE TRAJECTORY. The charisma multiplier each future life runs at is not modelled from an economy — it is
// MEASURED: labtraj.js LAB_TRAJ (tools/sim/chatraj.mjs) holds every hacking-route clear this stack played, as
// the installed charisma product per life in units of its node's length. The live arm prices the remaining labs
// on EACH clear's shape from the live state (labArmOf: the live multiplier now x that clear's growth from this
// node fraction on), so the arm's spread is the measured spread of trajectories (a bootstrap), and a clear on
// which a remaining lab cannot be reached (a climb past chaplan.CLIMB_CAP_H) is a FAILED trajectory: priced as
// the fallback — the lab route until the stall is seen (detectH), then the black ops from there.
//
// THE STALL (labStallOf): the live multiplier under the measured clears' 10% quantile at this node fraction
// (STALL.multTol beyond it), or a lab not installed past the fraction by which 75% of the clears had installed it
// (STALL.phiSlack beyond it). A stalled climb is re-priced with NO further growth (the live multiplier held):
// the arm then fails exactly where the remaining labs are out of reach at what the player has, and the route
// decision moves to the black ops on its own pricing (plan.decideBladeRouteGen `lab`). The health check
// (labClimbHealthOf) reads the SAVE (the charisma level and exp, the installed lab augmentations), never the
// planner's own record alone: LAB CLIMB STALLED.
//
// NOT SIMULATED (stated): the Daedalus join and Red Pill reputation the hacking exit still prices (the arm's
// hacking part is exitplan's, whose Red Pill is Daedalus's — pessimistic for this arm); the farm's home RAM
// against the batcher's money; the economy a forced lab install resets beyond LAB_INSTALL_H.
import { labScheduleOf, climbOf, LAB_CHA, FARM_MAX_GB, WORKER_GB, LAB_AUG_CHA, LAB_CHA_MARGIN, CRAWL_MIN, trajProdAt } from 'chaplan.js'
import { LAB_TRAJ } from 'labtraj.js'
export { CRAWL_MIN, CRAWL_RUNS, CRAWL_MEASURED_AT, trajProdAt, trajLivesOf } from 'chaplan.js'

/** The Source-Files' charisma (applySourceFile.ts: SF1 16/8/4%, SF2 24/12/6%, SF3 8/4/2% per level, compounding in the sum). `sf` the levels as a Map, [[n, lvl]] or {n: lvl} — read by the caller (sfgate.sfLevel in game; the save digest in the health check). */
export const SF_CHA_PCT = { 1: 16, 2: 24, 3: 8 }
export function sfChaMultOf(sf) {
  const lvl = (n) => {
    if (sf instanceof Map) return sf.get(n) ?? 0
    if (Array.isArray(sf)) return sf.find((x) => x?.[0] === n)?.[1] ?? 0
    return sf?.[n] ?? 0
  }
  let m = 1
  for (const [n, pct] of Object.entries(SF_CHA_PCT)) {
    let s = 0
    for (let i = 0; i < Math.min(3, lvl(Number(n))); i++) s += pct / 2 ** i
    m *= 1 + s / 100
  }
  return m
}

/** The total charisma multiplier the save's charisma level and exp imply (skill.ts calculateSkill inverted); null under level 50 (too coarse). */
export function liveChaMultOf(level, exp) {
  if (!(level >= 50) || !(exp >= 0)) return null
  const d = 32 * Math.log(exp + 534.6) - 200
  return d > 0 ? level / d : null
}

/**
 * The lives FROM NOW on trajectory `c`: the measured clear's OWN life structure (its lives as fractions of its
 * node, LAB_TRAJ) laid on this node's priced length T = nodeH + remH and cut at now — the life containing this
 * node fraction runs from now to its end, then the clear's later lives; the last is the final window. Each life's
 * product is the growth `c` shows from this node fraction to the life's start (x `giftCha`: Genesis's x0.9 where
 * the priced option accepts the gift now; 1 when `stalled`); its farm RAM the live farm's now, later the larger
 * of it and the clear's home RAM then (capped at FARM_MAX_GB, LAB_TRAJ). A trajectory with no lives: lives of
 * `cycleH` (the hacking route's) with a final window of `finalFrac` (the clears' median).
 */
export function liveLivesOf({ c, nodeH, remH, cycleH, farmGB, stalled = false, giftCha = 1, finalFrac = LAB_TRAJ.finalFrac }) {
  const fin = (x) => typeof x === 'number' && isFinite(x)
  if (!fin(remH) || remH <= 0) return [{ startH: 0, lenH: 0, prod: giftCha, ramGB: farmGB }]
  const T = Math.max(1e-6, (fin(nodeH) ? nodeH : 0) + remH)
  const phi0 = (T - remH) / T
  const g0 = trajProdAt(c, phi0)
  const growth = (phi) => (stalled ? 1 : Math.max(1, trajProdAt(c, phi) / g0))
  const lives = []
  const L = Array.isArray(c?.lives) ? c.lives : []
  if (L.length >= 2) {
    for (let j = 0; j < L.length; j++) {
      const [s, len, , gb] = L[j]
      const end = j + 1 < L.length ? L[j + 1][0] : Math.max(s + len, 1)
      if (end <= phi0 + 1e-9 && j + 1 < L.length) continue
      const from = Math.max(s, phi0)
      const h0 = (from - phi0) * T
      const h1 = j + 1 < L.length ? (end - phi0) * T : remH
      const ram = lives.length === 0 ? farmGB : Math.max(farmGB, Math.min(gb ?? 0, FARM_MAX_GB))
      lives.push({ startH: h0, lenH: Math.max(0, h1 - h0), prod: growth(from) * giftCha, ramGB: ram, ...(j + 1 === L.length ? { final: true } : {}) })
    }
    return lives
  }
  const cyc = fin(cycleH) && cycleH > 0 ? cycleH : 2
  const finalH = Math.min(remH, Math.max(0, (fin(finalFrac) ? finalFrac : 0) * T))
  const preH = remH - finalH
  for (let t = 0; t < preH - 1e-9; t += cyc) lives.push({ startH: t, lenH: Math.min(cyc, preH - t), prod: growth(phi0 + t / T) * giftCha, ramGB: farmGB })
  lives.push({ startH: preH, lenH: finalH, prod: growth(phi0 + preH / T) * giftCha, ramGB: farmGB, final: true })
  return lives
}

/**
 * THE LAB ARM'S LEG, per trajectory: `live` {mult (player.mults.charisma: Source-Files + every installed
 * augmentation), nodeMult (the node's CharismaLevelMultiplier), expMult, int, exp (charisma exp this life),
 * labIndex (dnetplan.labOf index)}; nodeH the node's age (lifeAgeH the life's, published); cycleH the hacking
 * route's life length (its exit inputs: only for a trajectory with no lives); farmGB the farm's RAM now. Returns {n, legOf(remH, i, giftCha) -> chaplan
 * labScheduleOf's record, memoised on (i, giftCha, remH to 2%)} — the trajectory index i in 0..n-1.
 */
export function labArmOf({ live, nodeH, lifeAgeH, cycleH, farmGB, stalled = false, trajs = LAB_TRAJ.clears, crawlMin = CRAWL_MIN }) {
  const base = { mult: live.mult * live.nodeMult, expMult: live.expMult ?? 1, int: live.int ?? 0 }
  const memo = new Map()
  // the climbs repeat across trajectories and lengths (a trajectory's product is a step function): memoised
  const climbs = new Map()
  const climb = (o) => {
    const k = `${o.target}|${o.mult.toFixed(6)}|${o.expMult}|${o.ramGB}|${o.int}|${o.exp0}`
    if (!climbs.has(k)) climbs.set(k, climbOf(o))
    return climbs.get(k)
  }
  const legOf = (remH, i, giftCha = 1) => {
    const n = trajs.length
    const ii = ((Math.floor(i) % n) + n) % n
    const q = Math.round(Math.log(Math.max(1e-3, remH)) / 0.02)
    const key = `${ii}|${giftCha}|${q}`
    if (!memo.has(key)) {
      const lives = liveLivesOf({ c: trajs[ii], nodeH, remH: Math.exp(q * 0.02), cycleH, farmGB, stalled, giftCha })
      memo.set(key, labScheduleOf({ lives, base, crawlMin, from: live.labIndex ?? 0, exp0: live.exp ?? 0, climb }))
    }
    return memo.get(key)
  }
  return { n: trajs.length, legOf, base, stalled }
}

/** The stall check's tolerances (labStallOf). */
export const STALL = { multTol: 0.05, phiSlack: 0.1 }
/** The band row at node fraction phi (the step below it). */
export function bandAt(phi, band = LAB_TRAJ.band) {
  let r = band[0]
  for (const b of band) if (b.phi <= phi + 1e-9) r = b
  return r
}
/**
 * LAB CLIMB STALLED, the predicate: `phi` the node fraction (node hours / the priced exit's total), `prod` the
 * live installed charisma product (Source-Files and the node's multiplier divided out), `labIndex` the labs
 * installed. Stalled when the product is under the clears' q10 at phi by more than STALL.multTol, or a lab is
 * not installed STALL.phiSlack past the fraction by which 75% of the clears had it (LAB_TRAJ.labDue).
 * Returns {stalled, kind ('mult' | 'labs' | null), why, q10, due}.
 */
export function labStallOf({ phi, prod, labIndex, band = LAB_TRAJ.band, labDue = LAB_TRAJ.labDue }) {
  const fin = (x) => typeof x === 'number' && isFinite(x)
  if (!fin(phi) || !fin(prod) || !fin(labIndex)) return { stalled: false, kind: null, why: `unread: ${!fin(phi) ? 'the node fraction ' : ''}${!fin(prod) ? 'the charisma product ' : ''}${!fin(labIndex) ? 'the lab index' : ''}`.trim(), unread: true }
  const b = bandAt(phi, band)
  const q10 = b?.q10 ?? null
  if (fin(q10) && prod < q10 / (1 + STALL.multTol)) return { stalled: true, kind: 'mult', q10, why: `the charisma augmentations' product ${prod.toFixed(3)} at node fraction ${phi.toFixed(2)} is under the measured clears' q10 ${q10} (by > ${Math.round(STALL.multTol * 100)}%)` }
  const next = labIndex + 1
  const due = (labDue ?? []).find((d) => d.lab === next)?.q75
  if (next <= LAB_CHA.length && fin(due) && phi > due + STALL.phiSlack) return { stalled: true, kind: 'labs', q10, due, why: `lab ${next} is not installed at node fraction ${phi.toFixed(2)}; 75% of the measured clears had it by ${due.toFixed(2)} (+${STALL.phiSlack} slack)` }
  return { stalled: false, kind: null, q10, due: due ?? null, why: `on the trajectory: product ${prod.toFixed(3)} vs q10 ${q10}${fin(due) ? `, lab ${next} due by ${due.toFixed(2)}` : ''}` }
}

/** The lab index from an installed list (labyrinth.ts order: the W1ngs, B00ts, H4mmer, St4ff, then The Red Pill in BN15). */
export const LAB_AUG_NAMES = ['The W1ngs of Icarus', 'The B00ts of Perseus', 'The H4mmer of Daedalus', 'The St4ff of Asclepius', 'The Red Pill']
export function labIndexOfNames(names) {
  const s = new Set(names ?? [])
  let i = 0
  while (i < LAB_AUG_NAMES.length && s.has(LAB_AUG_NAMES[i])) i++
  return i
}

/**
 * LAB CLIMB STALLED (tools/healthcheck.mjs) from the SAVE: `state` the save digest (bitNode, lastNodeReset,
 * skills / exp charisma, augmentations), `sf` its Source-File levels ([[n, lvl]], the caller reads them off the
 * digest: sfgate.js is the one place in game code that does), `route` /tel/progress.txt's route of this node (its `lab`
 * record: the planner's own verdict, cross-checked), `now` ms. Only in BitNode 15 while the acted route is the
 * labyrinth's ('hack' with a lab record). The node fraction is the node's age (the save's) over the priced exit
 * (the lab record's totalH: the clock the arm judged its stall on; LAB_TRAJ's transfer length when absent); the
 * product and the labs installed are the SAVE's. Returns [{problem, detail}].
 */
export function labClimbHealthOf({ state, route, sf = [], now = Date.now(), nodeMult = 1.1, T15 = LAB_TRAJ.transfer?.T15 }) {
  const P = 'LAB CLIMB STALLED'
  if (!state || state.bitNode !== 15 || !route || route.route !== 'hack' || !route.lab) return []
  const fin = (x) => typeof x === 'number' && isFinite(x)
  const lab = route.lab
  // the priced trajectory's clock: the node's age + the hacking exit the lab arm was priced on (else the transfer length)
  const T = fin(lab.totalH) && lab.totalH > 0 ? lab.totalH : T15
  const nodeH = fin(state.lastNodeReset) ? (now - state.lastNodeReset) / 3.6e6 : null
  const lm = liveChaMultOf(state.skills?.charisma, state.exp?.charisma)
  const sfm = sfChaMultOf(sf)
  const prod = fin(lm) ? lm / (sfm * nodeMult) : null
  const names = (state.augmentations ?? []).map((a) => (typeof a === 'string' ? a : a?.name))
  const idx = labIndexOfNames(names)
  const out = []
  if (lab.priced !== true) out.push({ problem: P, detail: `the lab arm is unpriced on the labyrinth route: ${lab.why ?? '?'}` })
  if (!fin(nodeH) || !(fin(T) && T > 0)) out.push({ problem: P, detail: `could not tell: ${!fin(nodeH) ? "the save's lastNodeReset " : ''}${!(fin(T) && T > 0) ? 'the priced exit (route.lab.totalH) ' : ''}unread — the check cannot run` })
  else if (!fin(prod)) {
    // charisma under level 50 a third of the way in: the farm never ran (the product cannot be read below it)
    if (nodeH / T > 0.3) out.push({ problem: P, detail: `charisma ${state.skills?.charisma ?? '?'} at node fraction ${(nodeH / T).toFixed(2)}: the farm is not climbing (the multiplier cannot even be read under level 50)` })
  } else {
    const v = labStallOf({ phi: nodeH / T, prod, labIndex: idx })
    if (v.stalled) out.push({ problem: P, detail: `${v.why} (from the save: charisma ${state.skills.charisma}, mult ${lm.toFixed(3)} / Source-Files ${sfm.toFixed(3)} / node ${nodeMult}); progress.js ${lab.stalled ? 'prices it stalled (no further growth; a failed trajectory falls back to the black ops)' : 'does NOT price it stalled'} — ${lab.why ?? ''}`.slice(0, 500) })
  }
  // the planner's state must be the save's (a lab index read differently is a stale or wrong record)
  if (fin(lab.labIndex) && lab.labIndex !== idx) out.push({ problem: P, detail: `progress.txt prices the labs from lab index ${lab.labIndex}; the save has ${idx} installed — the lab arm is priced on a stale state` })
  return out
}

/** The labs' charisma at a margin, for the record (dnet-seed.js farms to it). */
export const LAB_TARGETS = LAB_CHA.map((c) => Math.ceil(c * LAB_CHA_MARGIN))
export const FARM_NOTE = `the farm: one-thread heartbleed workers (${WORKER_GB}GB) on home's free RAM, at most ${FARM_MAX_GB}GB; the lab augmentations' charisma ${LAB_AUG_CHA.join('/')}`
