// THE CHARISMA PLAN (BitNode 15's labyrinths). Pure: no ns, no RAM — imported by dnet-seed.js, dnet.js,
// augplan.js and the gameplan, and by the tests.
//
// WHY CHARISMA IS THE ROUTE: each labyrinth refuses every step below its charisma (labyrinth.ts
// handleLabyrinthPassword: Player.skills.charisma < lab.cha -> NotEnoughCharisma), and the servers above
// it ask ~0.85 x the lab's charisma for heartbleed's feedback (DarknetServerOptions.ts DnetServerBuilder:
// (depth / labDepth)^1.5 x labCha x 0.85). Lab charisma 300 / 600 / 1500 / 2500 / 3000 for BN15's five.
//
// LEVEL = mult x (32 ln(exp + 534.6) - 200) (skill.ts calculateSkill), mult = the player's charisma
// multiplier x BN15's CharismaLevelMultiplier 1.1. LINEAR in the multiplier, LOGARITHMIC in exp — so, as
// for hacking (installgate.js), the multiplier is the whole game: charisma 3000 is 7.2e10 exp at mult 5,
// 4.4e11 at 4.56, 1e16 at 3 and 1e20 at 2.28 (SF1.3 x SF2.3 x SF3.3 x 1.1, applySourceFile.ts:31,59,69 —
// this save's floor with no augmentation). Exp resets at every install; the multiplier does not.
//
// THE EXP SOURCE (the farm, dnet-cha.js): ns.dnet.heartbleed on the cheapest target in reach (darkweb from
// home: requiredCharismaSkill 1, difficulty 0, never underleveled). Per call 50 x charisma_exp x
// (500 + cha) / 500 exp, independent of threads (Darknet.ts heartbleed: xpGained); the call takes 1.5 x the
// authentication time (Darknet.ts:255-257, effects.ts calculateAuthenticationTime), which threads only
// shorten by 1 + 0.2(t-1) — so ONE-THREAD workers are 5x the exp per GB of a 5-thread one. A worker is
// 1.6 + 0.6 = 2.2GB. The rate rises ~cha^2 (both the exp and 1/time grow with it): per GB per second
// ~25 at charisma 10, ~120 at 300, ~590 at 1000, ~2700 at 2500 (x charisma_exp, x the intelligence bonus).
// CALIBRATION: farmRateOf is checked against the game's own heartbleed in tools/sim/entry/dnetlab.mjs
// --farm-min (the measured exp/s printed beside this model's, every run).
//
// What is NOT modelled here (stated, never folded in): sleeves at university (Leadership) and the
// player's own course — their exp reaches the player at sleeve sync (Sleeve/Work/Work.ts applySleeveGains),
// a second source this plan ignores (it only shortens the climb); the money and RAM the farm's home RAM
// would otherwise earn (the farm here runs on RAM the stack leaves free, never a claimed block).

export const LAB_CHA = [300, 600, 1500, 2500, 3000] // labyrinth.ts labData, BN15's five (dnetplan.LABS)
export const WORKER_GB = 2.25 // dnet-cha.js: 1.6 base + heartbleed 0.6 + getHostname 0.05 (RamCostGenerator.ts; DN7 checks it)
export const CHA_NODE_MULT = { 15: 1.1 } // BitNode.tsx case 15 CharismaLevelMultiplier
// the farm's target over a lab's charisma: AT the requirement every step pays the underleveled factor
// (effects.ts calculateAuthenticationTime: cha <= required -> x 1.5 + (req + 50)/(cha + 50), ~2.5x)
export const LAB_CHA_MARGIN = 1.02
// THE FARM'S CEILING (dnet-seed.js farmStep imports it): one-thread workers, at most FARM_MAX of them (each is a
// script the game loop schedules) — so at most FARM_MAX_GB of home RAM farms, however big home is
export const FARM_MAX = 400
export const FARM_MAX_GB = FARM_MAX * WORKER_GB

/** skill.ts calculateSkill */
export function levelOf(exp, mult) {
  if (!(mult > 0)) return 1
  return Math.max(1, Math.floor(mult * (32 * Math.log(exp + 534.6) - 200)))
}
/** skill.ts calculateExp (without its float-rounding walk): the exp at which `level` is reached. */
export function expFor(level, mult) {
  return Math.max(0, Math.exp((level / mult + 200) / 32) - 534.6)
}
/** intelligence.ts calculateIntelligenceBonus */
export function intBonus(int, weight) {
  return 1 + (weight * Math.pow(Math.max(0, int), 0.8)) / 600
}

/**
 * effects.ts calculateAuthenticationTime, ported (ms). `s` = {req, diff, depth, modelId?}; `p` = {cha, int,
 * threads, boots (The B00ts installed), sf15 (SF15 level), backdoor (the instability factor, default 1)}.
 */
export function authTimeMs(s, p) {
  const req = s.req ?? 0
  const diff = s.diff ?? 0
  const threads = Math.max(1, p.threads ?? 1)
  const skillFactor = (5 * req + (diff + 1) * 100) / (p.cha + 150)
  const under = p.cha <= req && (s.depth ?? 0) > 1 ? 1.5 + (req + 50) / (p.cha + 50) : 1
  const boots = p.boots ? 0.8 : 1
  const sf15 = (p.sf15 ?? 0) >= 2 ? 0.8 : 1
  const threadsFactor = 1 / (1 + 0.2 * (threads - 1))
  return 850 * skillFactor * (p.backdoor ?? 1) * under * boots * sf15 * threadsFactor / intBonus(p.int ?? 0, 0.25)
}

/** darkweb as the farm's target (NetworkGenerator.ts initDarkwebServer: difficulty 0, depth -1; required charisma 1). */
export const DARKWEB = { req: 1, diff: 0, depth: -1 }

/** Exp per second of ONE single-thread heartbleed worker on `target` at charisma `cha` (Darknet.ts:240-300). */
export function workerRateOf({ cha, expMult = 1, int = 0, boots = false, sf15 = 0, target = DARKWEB }) {
  if (cha < (target.req ?? 0)) return 0
  const perCall = expMult * 50 * ((500 + cha) / 500)
  const ms = 1.5 * authTimeMs(target, { cha, int, threads: 1, boots, sf15 })
  return perCall / (Math.max(ms, 4) / 1000) // a timer is never shorter than ~4ms (the browser's nested clamp)
}
/** The farm: `workers` single-thread heartbleed workers. */
export function farmRateOf({ cha, workers, expMult = 1, int = 0, boots = false, sf15 = 0, target = DARKWEB }) {
  return workers * workerRateOf({ cha, expMult, int, boots, sf15, target })
}

/**
 * The CLIMB: hours from `exp0` to charisma `target` at level multiplier `mult` with a farm of `ramGB`
 * (workers = floor(ramGB / WORKER_GB)) — the ODE dE/dt = farmRate(level(E)) integrated in level steps
 * (the rate is a function of the level, which is a step function of E). Returns {h, exp, workers, why};
 * h = Infinity when the farm is empty, h = 0 when already there. `extraPerSec` is any other exp source
 * (sleeves at university, the player's course) already scaled to the player.
 */
export function climbOf({ target, mult, expMult = 1, ramGB = 0, exp0 = 0, int = 0, boots = false, sf15 = 0, extraPerSec = 0, workerGB = WORKER_GB, maxWorkers = FARM_MAX }) {
  // the farm is capped at FARM_MAX workers (dnet-seed.js farmStep): RAM past FARM_MAX_GB buys nothing
  const workers = Math.min(maxWorkers, Math.floor(Math.max(0, ramGB) / workerGB))
  const need = expFor(target, mult)
  if (exp0 >= need) return { h: 0, exp: need, workers, why: 'already there' }
  if (workers <= 0 && !(extraPerSec > 0)) return { h: Infinity, exp: need, workers, why: 'no farm RAM and no other charisma source' }
  // level by level: at level L the farm runs at rate(L) until the exp of level L+1
  let e = exp0
  let s = 0
  for (let lv = levelOf(exp0, mult); lv < target; lv++) {
    const rate = farmRateOf({ cha: lv, workers, expMult, int, boots, sf15 }) + extraPerSec
    if (!(rate > 0)) return { h: Infinity, exp: need, workers, why: `no exp at charisma ${lv}` }
    const next = Math.min(need, expFor(lv + 1, mult))
    if (next > e) {
      s += (next - e) / rate
      e = next
    }
  }
  return { h: s / 3600, exp: need, workers, why: `${workers} heartbleed workers on darkweb from charisma ${levelOf(exp0, mult)}` }
}

/**
 * The charisma multiplier a set of INSTALLED augmentations gives, with `base` = the Source-File multiplier
 * (no augmentation) and `node` mult. `augMults` maps a name to its charisma multiplier (Augmentations.ts
 * mults.charisma); NeuroFlux levels are `nfg` (1.01 each).
 */
export function chaMultOf({ base, nodeMult = 1.1, installed = [], augMults = {}, nfg = 0 }) {
  let m = base * nodeMult * 1.01 ** nfg
  for (const a of installed) m *= augMults[a] ?? 1
  return m
}

/**
 * The charisma multiplier lab `k` (1..5) needs for its climb to fit `hours` on a farm of `ramGB`
 * (bisection on climbOf). The aug plan's target: what to have installed before that lab's life.
 */
export function multNeededOf({ target, hours, ramGB, expMult = 1, int = 0 }) {
  let lo = 0.5
  let hi = 50
  if (climbOf({ target, mult: hi, expMult, ramGB, int }).h > hours) return null
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (climbOf({ target, mult: mid, expMult, ramGB, int }).h > hours) lo = mid
    else hi = mid
  }
  return hi
}

/**
 * THE AUG VALUE for the charisma plan (augplan.js, BN15 on the lab route): the hours one augmentation's
 * charisma multiplier `m` saves on the remaining labs' climbs, priced as two trajectories — every remaining
 * lab's climb at the multiplier WITH the aug against WITHOUT it, same farm, same exp mult. `labs` = the
 * labs the aug will be installed for: [{cha, m}] (m = the lab augs installed by then, x the base `mult`),
 * or plain charisma numbers. A climb past CLIMB_CAP_H is priced AT the cap (an unreachable lab is the black
 * ops' fallback, not an infinity). Returns {withH, withoutH, savedH, capped}.
 */
export const CLIMB_CAP_H = 500
export function chaAugValueOf({ m = 1, mx = 1, mult, expMult = 1, ramGB, int = 0, labs }) {
  let capped = 0
  const sum = (mu, ex) =>
    labs.reduce((t, l) => {
      const cha = typeof l === 'number' ? l : l.cha
      const lm = typeof l === 'number' ? 1 : l.m ?? 1
      const h = climbOf({ target: cha, mult: mu * lm, expMult: ex, ramGB, int }).h
      if (h > CLIMB_CAP_H) capped++
      return t + Math.min(h, CLIMB_CAP_H)
    }, 0)
  const withoutH = sum(mult, expMult)
  const withH = sum(mult * m, expMult * mx)
  return { withH, withoutH, savedH: withoutH - withH, capped }
}

/**
 * The labs an augmentation bought NOW helps: those after the one this save faces (it is installed at the
 * next install, which is that lab's — dnetplan.labInstallOf), through the 5th (The Red Pill's), each with
 * the lab augmentations' charisma installed by then (Augmentations.ts: Wings 1.05, Boots 1.06, Hammer
 * 1.07, Staff 1 (charisma_exp 1.1, not modelled), Law 1.09). `index` = dnetplan.labOf(...).index.
 */
/**
 * The aug planner's charisma context (objective.charismaValue's ctx.chaLabs), or {} off the labyrinth
 * route. `labIndex` = dnetplan.labOf(installed, 15).index; `player` = {mults: {charisma, charisma_exp},
 * skills: {intelligence}}; `nodeMult` = the node's CharismaLevelMultiplier; `homeGB` the home RAM (the
 * farm's RAM when the lab is the life's gate: home less `reserveGb`); `hoursPerLn` the exit's hours per
 * hacking-ln (the GATE record's exitSensitivity). Missing inputs leave the field null — charismaValue
 * then prices 0 WITH the reason.
 */
export function chaLabsCtxOf({ node, labRoute, labIndex, player, nodeMult, homeGB, reserveGb = 0, hoursPerLn }) {
  if (node !== 15 || !labRoute) return {}
  const num = (x) => typeof x === 'number' && isFinite(x)
  const mult = num(player?.mults?.charisma) && num(nodeMult) ? player.mults.charisma * nodeMult : null
  const ramGB = num(homeGB) ? Math.max(0, homeGB - (num(reserveGb) ? reserveGb : 0)) : null
  const why = [mult === null ? 'the charisma multiplier' : null, ramGB === null ? 'home RAM' : null, !(num(hoursPerLn) && hoursPerLn > 0) ? "the exit's hours per hacking-ln (GATE exitSensitivity)" : null].filter(Boolean)
  return {
    chaLabs: {
      labs: num(labIndex) ? labsAheadOf(labIndex) : [],
      mult,
      expMult: num(player?.mults?.charisma_exp) ? player.mults.charisma_exp : 1,
      ramGB,
      int: num(player?.skills?.intelligence) ? player.skills.intelligence : 0,
      hoursPerLn: num(hoursPerLn) ? hoursPerLn : null,
      why: why.length ? `unread: ${why.join(', ')}` : null,
    },
  }
}

export const LAB_AUG_CHA = [1.05, 1.06, 1.07, 1, 1.09]
export function labsAheadOf(index) {
  const out = []
  let m = 1
  for (let k = 0; k < LAB_CHA.length; k++) {
    if (k > 0) m *= k - 1 >= index ? LAB_AUG_CHA[k - 1] : 1 // lab k's augmentation is installed before lab k+1
    if (k > index) out.push({ cha: LAB_CHA[k], m })
  }
  return out
}

// ---------------------------------------------------------------- THE LAB SCHEDULE (the charisma trajectory)
/** A lab install the hacking route would have made later: the life's reset (lab15.mjs's install allowance, mid). */
export const LAB_INSTALL_H = 0.25
/** The lab augmentations' charisma_exp (Augmentations.ts:1911: The St4ff of Asclepius 1.1), installed before lab k (index k-1). */
export const LAB_AUG_CHA_EXP = [1, 1, 1, 1, 1.1]
/** The lab augmentations' charisma product installed before lab k (index k-1): Wings, Boots, Hammer (Staff 1). */
export const LAB_AUG_BEFORE = LAB_CHA.map((_, k) => LAB_AUG_CHA.slice(0, k).reduce((p, x) => p * x, 1))

/**
 * THE LAB SCHEDULE ON A LIFE TRAJECTORY: `lives` [{startH, lenH, prod, ramGB}] — the hacking route's lives in
 * order (the LAST is the final window, after the terminal install), each with the charisma augmentations'
 * product it runs at (NeuroFlux included) and the farm's RAM; `base` {mult (Source-Files x the node's 1.1),
 * expMult, int}; `crawlMin` {k: game minutes from the life's start to lab k's reward queued, measured}.
 * Lab k is cleared in the first life where its climb from exp 0 (an install resets exp) at base x the lab
 * augmentations x prod, plus its crawl, fits in what is left of the life; a cleared lab 1-4 forces its install
 * (dnetplan.labInstallOf) — LAB_INSTALL_H to the leg, and the next lab climbs from 0 in what is left of that
 * life. Lab 5 (The Red Pill) must clear before the final window. Labs left after the last pre-final life are
 * HELD there (the install held until each climb completes: hours past the life's end are the leg's); a climb
 * past capH FAILS (priced at capH: the black ops are the fallback). From the LIVE state: `from` = the labs
 * already installed (dnetplan.labOf index; `prod` then already carries their charisma — only the ones still
 * ahead are applied) and `exp0` the charisma exp the first life holds now. Returns {legH, heldH, installs,
 * failed, detectH (a failed or held schedule: the start of the life it is held in — when the climb is seen to stall),
 * doneH (lab 5's clear on the lives' clock, held included), labs: [{lab, life, mult, climbH, needH, atH}]}.
 */
export function labScheduleOf({ lives, base, crawlMin = {}, capH = CLIMB_CAP_H, installH = LAB_INSTALL_H, margin = LAB_CHA_MARGIN, from = 0, exp0 = 0, climb = climbOf }) {
  const labs = []
  const pre = (lives ?? []).slice(0, -1)
  const k0 = Math.max(0, Math.min(LAB_CHA.length, Math.floor(from) || 0))
  let k = k0
  let installs = 0
  let heldH = 0
  let failed = false
  let detectH = null
  let doneH = null
  let e0 = exp0 > 0 ? exp0 : 0 // the first climb's exp in hand (the live life's); every later one starts at 0
  const needOf = (kk, prod, ramGB) => {
    const mult = base.mult * (LAB_AUG_BEFORE[kk] / LAB_AUG_BEFORE[k0]) * prod
    const xm = (base.expMult ?? 1) * (LAB_AUG_CHA_EXP[kk] / LAB_AUG_CHA_EXP[k0])
    const c = climb({ target: Math.ceil(LAB_CHA[kk] * margin), mult, expMult: xm, ramGB, int: base.int ?? 0, exp0: e0 })
    const crawlH = (Number.isFinite(crawlMin[kk + 1]) ? crawlMin[kk + 1] : 30) / 60
    return { mult, climbH: c.h, needH: c.h + crawlH }
  }
  for (let j = 0; j < pre.length && k < LAB_CHA.length; j++) {
    const L = pre[j]
    if (j > 0) e0 = 0
    let t = 0
    while (k < LAB_CHA.length) {
      const n = needOf(k, L.prod, L.ramGB)
      if (!(n.needH <= L.lenH - t)) break
      t += n.needH
      e0 = 0
      labs.push({ lab: k + 1, life: j, mult: +n.mult.toFixed(4), climbH: +n.climbH.toFixed(3), needH: +n.needH.toFixed(3), atH: +(L.startH + t).toFixed(3) })
      if (k === LAB_CHA.length - 1) doneH = L.startH + t
      else installs++
      k++
    }
  }
  if (k < LAB_CHA.length) {
    // HELD in the last pre-final life (or the first life when there is no other): what is left climbs there in turn
    const j = Math.max(0, pre.length - 1)
    const L = pre[j] ?? lives?.[0] ?? { startH: 0, lenH: 0, prod: 1, ramGB: 0 }
    if (j > 0) e0 = 0
    let t = labs.filter((l) => l.life === j).reduce((s, l) => s + l.needH, 0)
    for (; k < LAB_CHA.length; k++) {
      const n = needOf(k, L.prod, L.ramGB)
      e0 = 0
      const over = !(n.needH <= capH)
      if (over) failed = true
      const need = over ? capH : n.needH
      t += need
      labs.push({ lab: k + 1, life: over ? null : j, mult: +n.mult.toFixed(4), climbH: +Math.min(n.climbH, capH).toFixed(3), needH: +need.toFixed(3), atH: +(L.startH + t).toFixed(3), held: true, ...(over ? { capped: true } : {}) })
      if (k < LAB_CHA.length - 1) installs++
    }
    heldH = Math.max(0, t - L.lenH)
    doneH = L.startH + t
    // a hold (a failed climb is one) is seen at the held life's start: the route can fall back from there (the caller prices it)
    if (heldH > 0 || failed) detectH = L.startH
  }
  return { legH: +(heldH + installs * installH).toFixed(3), heldH: +heldH.toFixed(3), installs, failed, detectH: detectH === null ? null : +detectH.toFixed(3), doneH: doneH === null ? null : +doneH.toFixed(3), labs }
}

/** The node-fraction grid of the trajectory band (phi = t / T). */
export const TRAJ_PHI = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]
/**
 * THE BAND (tools/sim/chatraj.mjs -> chatraj.json -> LAB_TRAJ): per node fraction phi, the quantiles over the
 * measured clears of the charisma product the life containing phi x T ran at. `clears` [{T, lives: [{startH, prod}]}].
 */
export function trajBandOf(clears) {
  const q = (xs, p) => {
    const v = [...xs].sort((a, b) => a - b)
    if (!v.length) return null
    const i = (v.length - 1) * p
    const lo = Math.floor(i)
    return +(v[lo] + (v[Math.min(v.length - 1, lo + 1)] - v[lo]) * (i - lo)).toFixed(4)
  }
  return TRAJ_PHI.map((phi) => {
    const xs = (clears ?? []).map((c) => {
      const t = phi * c.T
      const l = [...c.lives].reverse().find((x) => x.startH <= t + 1e-9) ?? c.lives[0]
      return l?.prod ?? 1
    })
    return { phi, q10: q(xs, 0.1), q25: q(xs, 0.25), q50: q(xs, 0.5), q75: q(xs, 0.75) }
  })
}

// ---------------------------------------------------------------- THE CRAWL (measured) and the trajectory's step function
// MEASURED: game minutes from the life's start (charisma at the lab's) to the reward queued, tools/sim/entry/dnetlab.mjs
// on the BN15.1 entry from the live save, warp 8, two full runs of all five labs (2026-10-25):
//   run3 (the walker before the stasis link and the block-freeing loop)  1.21 / 7.29 /  7.34 / 50.32 / 20.43
//   run4 (the code of 3d894b0)                                            0.88 / 9.57 / 24.52 / 24.12 / 26.57
export const CRAWL_RUNS = { run3: [1.21, 7.29, 7.34, 50.32, 20.43], run4: [0.88, 9.57, 24.52, 24.12, 26.57] }
export const CRAWL_MIN = Object.fromEntries([1, 2, 3, 4, 5].map((k) => [k, +((CRAWL_RUNS.run3[k - 1] + CRAWL_RUNS.run4[k - 1]) / 2).toFixed(2)]))
export const CRAWL_MEASURED_AT = 'tools/sim/entry/dnetlab.mjs 2026-10-25 (two runs, warp 8)'

/** A trajectory's installed charisma product at node fraction phi (its lives are a monotone step function). */
export function trajProdAt(c, phi) {
  let p = c?.lives?.[0]?.[2] ?? 1
  for (const l of c?.lives ?? []) if (l[0] <= phi + 1e-9) p = l[2]
  return p
}

/** Offline: a compact clear's lives on a node of T hours ([{startH, lenH, prod, ramGB}], chaplan.labScheduleOf's). */
export function trajLivesOf(c, T) {
  return (c?.lives ?? []).map(([s, l, p, gb]) => ({ startH: s * T, lenH: l * T, prod: p, ramGB: Math.min(gb ?? 0, FARM_MAX_GB) }))
}

