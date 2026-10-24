// THE BLADEBURNER EXIT, simulated by running the game's own Bladeburner.
//
// ---------------------------------------------------------------------------
// CALIBRATED 2026-10-02 on the live BN6 run (bbcal6.mjs: the live Bladeburner leg
// was 0.916 x this model run on the same fleet timing). The text below predates it:
// NOT CALIBRATED — and it cannot be yet. No node of this playthrough has had
// Bladeburner access (it needs BitNode 6/7 or Source-File 6/7), so there is no
// live quantity to reproduce. Every FORMULA below is the game's: the actions,
// success chances, action times, rank gain and loss, stamina, skill costs and
// multipliers, cities (population, chaos, communities, random events), black
// operations, gym training, the Bladeburners faction's favor, and the sleeves'
// infiltrate/gym work are the real classes out of ~/Repos/bitburner (bundled
// by ./build.mjs). What is NOT the game's is the POLICY (which action and
// level, which skills, when to rest, when to install, where the sleeves go)
// and the player's COMBAT MULTIPLIER schedule, so the output is bounded —
// optimistic / pessimistic — and never point-estimated (CLAUDE.md "Calibrate
// against the live game, or say the model is uncalibrated").
// ---------------------------------------------------------------------------
//
// THE EXIT. Bladeburner/ui/BlackOpPage.tsx:39-50 offers "Destroy w0r1d_d43m0n"
// once numBlackOpsComplete >= numberOfBlackOperations (21), and
// NetscriptFunctions/Singularity.ts:1154-1158 accepts the same condition for
// destroyW0r1dD43m0n — no hacking level, no Red Pill. The last black op,
// Operation Daedalus, needs rank 400k (data/BlackOperations.ts:705-709) at
// difficulty 80,000.
//
// THE COMBAT MULTIPLIER is what decides it: a stat's level is
// mult x (32 ln(exp + 534.6) - 200) (skill.ts:13), so combat levels in the
// thousands come from augmentations, not exp. This run buys them on the same
// install cadence and at the same ln-growth per hour `g` as the hacking path's
// multiplier in the same node (hackexit.mjs) — one economy, spent on combat
// instead of hacking: every `installEveryH` hours the combat multipliers rise
// by exp(g x installEveryH), and every Bladeburners-faction augmentation whose
// reputation (Formulas.ts calculateActionReputationGain, 2 x rank) is held is
// bought — then the install resets combat exp to 0 (prestigeAugmentation) and
// the player retrains at the gym while rank, skills and the faction's favor
// persist. The combat catalogue (strength x1130 over every augmentation,
// agility x72) does not bind within any run here, unlike hacking's x22.9.
//
// WHAT IS REPLICATED RATHER THAN CALLED, and why: Bladeburner.process()
// (Bladeburner.ts:1350-1430) returns immediately while Router.page() is the
// LoadingScreen, and the Router is module state of ui/GameRoot.tsx that only
// the mounted React tree replaces. So `tick` repeats process()'s orchestration
// — calculateMaxStamina, stamina gain, count growth, passive chaos decay,
// random events, processAction — each a call into the game's own method. The
// popup/automation branches are omitted (no Player.currentWork, automation
// off).
//
// FIXED INPUTS, stated (CLAUDE.md: what the simulator cannot see is published):
//   - money is not binding (gym fees, hospitalisation, the augmentations) — the
//     hacking scripts and the stock trader run beside this and are not
//     simulated here: OPTIMISTIC;
//   - no team (teamCount 0; Recruitment never chosen): a team adds (n+1)^0.05
//     to op competence (Operation.ts operationTeamSuccessBonus): PESSIMISTIC;
//   - the player's hacking level is a fixed input (it weighs 1/7..0.1 of
//     competence at decay 0.6-0.9);
//   - sleeves arrive shocked (Sleeve.prestige: shock 100 -> exp x0) and are put
//     on Infiltrate (stat- and shock-independent, SleeveInfiltrateWork.ts) or
//     the gym (their exp reaches the player at sync x their shock bonus,
//     Work.ts applySleeveGains), never on contracts.

import '../../test/gameresolve.mjs'
import g, { setBitNode } from './game.mjs'
// bbplan.js imports by the game's bare spelling ('coop.js'): load it after gameresolve's hook is registered.
const bp = await import('bbplan.js')
const sp = await import('../../../stanekplan.js')
const gp = await import('goplan.js')

const T = g.BladeburnerActionType
const SK = g.BladeburnerSkillName
const C = g.BladeburnerConstants
const COMBAT = ['strength', 'defense', 'dexterity', 'agility']

/** mulberry32: the game draws from Math.random; a run is seeded by replacing it. */
export function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Formulas.ts:30-44 calculateActionRankLoss at a level (two lines; not exported by the bundle). */
const rankLossAt = (a, L) => (a.rankLoss ?? 0) * Math.pow(a.rewardFac, L - 1)

/** The Bladeburners faction's augmentations (Augmentations.ts factions: [Bladeburners]) minus The Blade's Simulacrum, cheapest reputation first. */
export function bladeburnerAugs() {
  return Object.values(g.Augmentations)
    .filter((a) => a.factions?.includes('Bladeburners') && a.name !== g.AugmentationName?.BladesSimulacrum && !/Simulacrum/.test(a.name))
    .map((a) => ({ name: a.name, repCost: a.baseRepRequirement ?? a.repCost, mults: a.mults, prereqs: a.prereqs ?? [] }))
    .sort((x, y) => x.repCost - y.repCost)
}

/** Bladeburner.process() minus the Router/popup/automation branches (Bladeburner.ts:1370-1411), in its order. */
function tick(bb, seconds) {
  if (bb.stamina <= 0) bb.resetAction() // Bladeburner.ts:1370-1373, before the tick
  bb.calculateMaxStamina()
  bb.stamina += bb.calculateStaminaGainPerSecond() * seconds
  bb.stamina = Math.min(bb.maxStamina, bb.stamina)
  for (const c of Object.values(bb.contracts)) c.count += (seconds * c.growthFunction()) / C.ActionCountGrowthPeriod
  for (const o of Object.values(bb.operations)) o.count += (seconds * o.growthFunction()) / C.ActionCountGrowthPeriod
  for (const city of Object.values(bb.cities)) city.chaos = Math.max(0, city.chaos - 0.0001 * seconds)
  bb.randomEventCounter -= seconds
  if (bb.randomEventCounter <= 0) {
    bb.randomEvent()
    bb.randomEventCounter += 240 + Math.floor(Math.random() * 361) // getRandomIntInclusive(240, 600)
  }
  bb.processAction(seconds)
}

/** Expected rank per second of `a` at level L, and its chance; restores a.level. */
function evAt(bb, P, a, L, useEst) {
  const keep = a.level
  a.level = L
  // useEst: decide on what the API shows (ns.bladeburner.getActionEstimatedSuccessChance ->
  // Action.getSuccessRange, NetscriptFunctions/Bladeburner.ts:138-142), taking the LOW end.
  let width = 0
  let p
  if (useEst) {
    const [lo, hi] = a.getSuccessRange(bb, P)
    p = lo
    width = hi - lo
  } else p = a.getSuccessChance(bb, P, { est: false })
  const time = a.getActionTime(bb, P)
  const gain = g.calculateActionRankGain(a, L)
  const loss = rankLossAt(a, L)
  a.level = keep
  return { p, width, time, ev: (p * gain - (1 - p) * loss) / time }
}

/** Raid multiplies the city's chaos by 1.01-1.05 per completion (Bladeburner.ts completeOperation Raid); past half the threshold, leave it. */
const RAID_CHAOS_GUARD = C.ChaosThreshold / 2

/** The best contract/operation and level for rank/sec with success >= thr. */
function bestAction(bb, P, pol) {
  let best = null
  for (const a of [...Object.values(bb.contracts), ...Object.values(bb.operations)]) {
    if (a.count < 1) continue
    if (a.name === 'Raid' && (bb.getCurrentCity().comms <= 0 || bb.getCurrentCity().chaos > RAID_CHAOS_GUARD)) continue
    if (evAt(bb, P, a, 1, pol.useEst).p < pol.thr) continue
    let lo = 1
    let hi = a.maxLevel
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2)
      if (evAt(bb, P, a, mid, pol.useEst).p >= pol.thr) lo = mid
      else hi = mid - 1
    }
    for (let L = lo; L >= Math.max(1, lo - 3); L--) {
      const r = evAt(bb, P, a, L, pol.useEst)
      if (!best || r.ev > best.ev) best = { a, L, ...r }
    }
  }
  return best
}

const SKILLS = [SK.BladesIntuition, SK.DigitalObserver, SK.Reaper, SK.EvasiveSystem, SK.Overclock, SK.Cloak, SK.ShortCircuit, SK.Tracer, SK.CybersEdge]

/** The skill greedy's objective: the next black op's chance while rank allows it and it is short, else rank/sec. */
function score(bb, P, pol) {
  const next = bb.blackOperationArray[bb.numBlackOpsComplete]
  if (next && bb.rank >= next.reqdRank) {
    const p = next.getSuccessChance(bb, P, { est: false })
    if (p < pol.blackThr) return { kind: 'blackop', v: p }
  }
  const b = bestAction(bb, P, pol)
  return { kind: 'rank', v: b ? b.ev : 0 }
}

/** Spend skill points greedily on relative d(score)/d(cost), in chunks of ~1/20 of the points held. */
function spendSkills(bb, P, pol) {
  for (let iter = 0; iter < 60; iter++) {
    if (bb.skillPoints < 1) return
    const base = score(bb, P, pol)
    let pick = null
    for (const name of SKILLS) {
      const sk = g.BladeburnerSkills[name]
      const lvl = bb.getSkillLevel(name)
      if (lvl >= sk.maxLvl) continue
      const budget = Math.max(1, Math.floor(bb.skillPoints / 20))
      let k = Math.max(1, sk.calculateMaxUpgradeCount(lvl, budget))
      k = Math.min(k, sk.maxLvl - lvl)
      const cost = sk.calculateCost(lvl, k)
      if (!(cost > 0) || cost > bb.skillPoints) continue
      bb.setSkillLevel(name, lvl + k)
      const s = score(bb, P, pol)
      bb.setSkillLevel(name, lvl)
      const gain = s.kind === base.kind ? s.v - base.v : s.kind === 'rank' ? Infinity : -Infinity
      const val = (base.v > 0 ? gain / base.v : gain) / cost
      if (!pick || val > pick.val) pick = { name, k, val }
    }
    if (!pick || !(pick.val > 0)) {
      // Nothing measurably moves the current objective: bank Blade's Intuition (+3% to every success chance).
      const sk = g.BladeburnerSkills[SK.BladesIntuition]
      const k = sk.calculateMaxUpgradeCount(bb.getSkillLevel(SK.BladesIntuition), Math.max(1, Math.floor(bb.skillPoints / 2)))
      if (k >= 1) bb.upgradeSkill(SK.BladesIntuition, k)
      return
    }
    if (!bb.upgradeSkill(pick.name, pick.k).success) return
  }
}

/** Travel is free and instant inside Bladeburner: go where population is highest and chaos tolerable. */
function pickCity(bb, pol) {
  let best = null
  for (const [name, c] of Object.entries(bb.cities)) {
    const pop = pol.useEst ? c.popEst : c.pop
    const chaosPen = c.chaos > C.ChaosThreshold ? Math.sqrt(1 + c.chaos - C.ChaosThreshold) : 1
    const v = Math.pow(pop / C.PopulationThreshold, C.PopulationExponent) / chaosPen
    if (!best || v > best.v) best = { name, v }
  }
  bb.city = best.name
}

const GYM = g.LocationName.Sector12PowerhouseGym
/** The stats a gym order trains (pol.train.stats, pol.sleeves.gymStats): combat stat names; default all four. */
export const gymStatsOf = (xs) => {
  const v = Array.isArray(xs) ? xs.filter((s) => COMBAT.includes(s)) : []
  return v.length ? v : COMBAT
}
/** The lowest of `stats` (below `to`, when given) — the gym class the player takes next. */
const lowestOf = (P, stats, to = Infinity) => {
  let low = null
  for (const s of stats) if (P.skills[s] < to && (!low || P.skills[s] < P.skills[low])) low = s
  return low
}

/** One step of the player at the gym on the lowest combat stat (Work/Formulas.ts:108 calculateClassEarnings, per cycle). */
function gymStep(P, seconds, stat = null) {
  let low = COMBAT[0]
  for (const s of COMBAT) if (P.skills[s] < P.skills[low]) low = s
  if (stat) low = stat
  const w = g.calculateClassEarnings(P, g.GymType[low], GYM)
  const cyc = seconds * 5
  P.gainStrengthExp(w.strExp * cyc)
  P.gainDefenseExp(w.defExp * cyc)
  P.gainDexterityExp(w.dexExp * cyc)
  P.gainAgilityExp(w.agiExp * cyc)
  P.updateSkillLevels()
}

/**
 * One run to the Bladeburner exit.
 *
 * o: { node, level (BitNode level; BN12), sf: [[n, lvl]] held (SF6 included by
 *      the caller when access comes from it), g: ln-growth/h of the combat
 *      multiplier (hackexit's economy latent), installEveryH, buyBladeAugs,
 *      policy: {thr, blackThr, restLow, restHigh, rest: 'hrc'|'fa', gymTo,
 *      sleeves: {infiltrate, gym}, useEst}, intelligence, hacking, seed, maxH,
 *      go: { perHour, power, goPower, sf14 } | null — THE GO FARM'S COMBAT CHANNEL:
 *        the farm on Tetrads from the node's start, its node power growing at perHour,
 *        every combat level multiplier x effect(nodes) (Go/effects/effect.ts:16-22 via
 *        goplan.effectAt, applied as updateGoMults does, effect.ts:59-63), re-read every
 *        60s of sim time; an install zeroes it (Go/Go.ts:34-47 prestigeAugmentation) and
 *        it regrows from 0 — the wipe bbplan's live exit prices (1c484da) }
 *      stanek: { placed: [{id, x, y, rot}], chargeAt(tSec) -> {highestCharge, numCharge} } | null —
 *        STANEK'S GIFT accepted at the node's start: Genesis's multipliers (the game's
 *        Augmentations["Stanek's Gift - Genesis"], x0.9 combat/charisma/hacking) from t 0, and
 *        the layout's calculateMults (stanekplan.layoutMults — the game's StaneksGift.calculateMults
 *        transcribed, every key checked identical against the game's class in ST1:
 *        combat stat + exp, charisma, the four bladeburner_* keys) at chargeAt's charge, re-read
 *        every 60s of sim time, merged multiplicatively as StaneksGift.updateMults does. The
 *        layout must be legal on the node's grid (stanekplan.giftSize/canPlace at the SF13 in
 *        o.sf: checked here). The charging POLICY is the caller's (chargeAt).
 *        THE PHASE PLAN (L2, o.stanek.phases + o.stanek.thrAt/duty in place of chargeAt):
 *        phases [{placed, when}] — phase 0 placed at t 0, phase j+1 re-laid when its `when`
 *        holds (stanekplan.whenHolds on {tH node hours, blackOps done, rank}), seen on the 60s
 *        gift step and landing o.stanek.lagS (default 300: stanek.js's 5-min watchdog pass)
 *        later. The charge is PER FRAGMENT (stanekplan.chargeTrackOf): a fragment unchanged
 *        across the re-lay keeps its charge, a removed or changed one loses it
 *        (StaneksGift.delete, StaneksGift.ts:112) and the new ones regrow from 0 (highestCharge
 *        back on the first call, numCharge +duty/k per second round robin). One phase = chargeAt
 *        exactly (SG13).
 *        THE CLOSED LOOP (L3, o.stanek.decide({t, P, bb, placed, charges, goEff, goNodes}) -> layout|null,
 *        with phases [{placed}]): called on every 60s gift step while no re-lay is pending; a layout it
 *        returns lands lagS later, the charge per fragment as above (tools/sim/stanekepoch.mjs --replay).
 *      multsPhase: { mults: {key: factor}, from: when|null, to: when|null } — extra multipliers
 *        only while `from` has held and `to` has not (the phase weights' probe, stanekphase.mjs)
 * returns { hours, rank, blackOps, done, installs, why, trace }
 */
export function runBladeburner(o) {
  const { node, level = 1, sf, policy: pol, intelligence = 0, hacking = 1, seed = 1, maxH = 600 } = o
  const growth = o.g ?? 0
  const every = o.installEveryH ?? null
  const mults = setBitNode(node, level)
  if (!(mults.BladeburnerRank > 0)) return { hours: null, done: false, why: `BladeburnerRank ${mults.BladeburnerRank} in BitNode ${node}: Bladeburner disabled` }
  const saved = Math.random
  Math.random = rng(seed)
  try {
    g.initSourceFiles()
    const P = new g.PlayerObject()
    g.setPlayer(P)
    P.bitNodeN = node
    P.sourceFiles = new Map(sf)
    if (!P.canAccessBladeburner()) return { hours: null, done: false, why: `no Bladeburner access in BitNode ${node} with SF ${JSON.stringify(sf)}` }
    const faction = g.Factions['Bladeburners']
    faction.prestigeSourceFile() // module state: a fresh node
    let augMult = 1 // the combat multiplier bought so far (general augmentations)
    const owned = new Set()
    // the Go farm's combat channel (o.go): effect now, and the node power's clock (zeroed by an install)
    const goC = o.go && o.go.perHour > 0 ? o.go : null
    let goEff = 1
    let goT0 = 0
    let goNext = 0
    // GRAFTS (o.grafts: {schedule: [name], wealth, moneyPerH, fare}): the game's GraftableAugmentation
    // (cost baseCost x 3, time / graftingIntBonus at focus), started in order the first step the slot
    // is free and wealth + moneyPerH x t - spent covers price + fare; applied at the end with one
    // entropy stack (calculateEntropy, the game's) unless the Congruity Implant is grafted (it clears
    // them). The slot: with the Simulacrum the actions go on and the parallel class stops; without
    // it the graft cancels the action (Bladeburner.ts:179, :1355). Money is otherwise not binding here.
    const gr = o.grafts && Array.isArray(o.grafts.schedule) && o.grafts.schedule.length ? o.grafts : null
    const grafted = new Set()
    let gi = 0
    let gRun = null
    let gSpent = 0
    let gStacks = 0
    let gCongruity = false
    const gDone = []
    const applyMults = () => {
      P.resetMultipliers()
      P.reapplyAllSourceFiles()
      for (const s of COMBAT) P.mults[s] *= augMult * goEff
      for (const a of bladeburnerAugs()) if (owned.has(a.name)) for (const [k, v] of Object.entries(a.mults ?? {})) if (typeof P.mults[k] === 'number') P.mults[k] *= v
      for (const name of grafted) for (const [k, v] of Object.entries(g.Augmentations[name]?.mults ?? {})) if (typeof P.mults[k] === 'number') P.mults[k] *= v
      if (gStacks > 0 && !gCongruity) P.mults = g.calculateEntropy(gStacks) // EntropyAccumulation.ts, on this Player
      P.updateSkillLevels()
    }
    // Stanek's Gift (o.stanek): the game's gift, placed once; its multipliers re-read from the charge
    const stC = o.stanek ?? null
    let stGift = null
    let stM = null
    let stNext = 0
    let stT0 = 0
    // the phase plan (o.stanek.phases): per-fragment charge, the next phase, its landing time
    let stTrack = null
    let stPhase = 0
    let stDue = null
    let stPending = null
    let stW = 0
    let stH = 0
    const stSwitches = []
    const genesis = stC ? g.Augmentations[sp.GENESIS]?.mults : null
    if (stC) {
      if (!genesis) throw new Error(`bbsim o.stanek: no '${sp.GENESIS}' augmentation in the bundle`)
      const l13 = new Map(sf).get(13) ?? 0
      const { width, height } = sp.giftSize(mults.StaneksGiftExtraSize ?? 0, l13) // StaneksGift.ts:20-32
      stW = width
      stH = height
      for (const lay of stC.phases ? stC.phases.map((ph) => ph.placed) : [stC.placed]) {
        const placed = []
        for (const p of lay) {
          if (!sp.canPlace(placed, width, height, p.x, p.y, p.rot, sp.fragmentById(p.id))) throw new Error(`bbsim o.stanek: fragment ${p.id} at ${p.x},${p.y} r${p.rot} not placeable on the ${width}x${height} grid (BN${node}, SF13.${l13})`)
          placed.push(p)
        }
      }
      stGift = { placed: stC.phases ? stC.phases[0].placed : stC.placed, nodePower: mults.StaneksGiftPowerMultiplier ?? 1 }
      if (stC.phases) stTrack = sp.chargeTrackOf({ thrAt: stC.thrAt, duty: stC.duty ?? sp.BLADE_HOST.duty }).relay(stGift.placed, 0)
    }
    const applyGift = () => {
      // o.mults: constant extra multipliers from t 0 ({key: factor}) — the elasticity probe (tools/sim/bbstanek.mjs)
      if (o.mults) for (const [k, v] of Object.entries(o.mults)) if (typeof P.mults[k] === 'number') P.mults[k] *= v
      if (genesis) for (const [k, v] of Object.entries(genesis)) if (typeof P.mults[k] === 'number') P.mults[k] *= v
      if (stM) for (const [k, v] of Object.entries(stM)) if (typeof P.mults[k] === 'number') P.mults[k] *= v
      if (exOn) for (const [k, v] of Object.entries(o.multsPhase.mults)) if (typeof P.mults[k] === 'number') P.mults[k] *= v
    }
    // o.multsPhase: the extra multipliers on while from has held and to has not (re-read on the 60s step)
    let exOn = false
    let exFrom = false
    const phaseState = (t) => ({ tH: t / 3600, blackOps: P.bladeburner?.numBlackOpsComplete ?? 0, rank: P.bladeburner?.rank ?? 0 })
    let exNext = 0
    const multsPhaseStep = (t) => {
      const mp = o.multsPhase
      if (!mp || t < exNext) return
      exNext = t + 60
      const s = phaseState(t)
      exFrom = exFrom || !mp.from || sp.whenHolds(mp.from, s)
      const on = exFrom && !(mp.to && sp.whenHolds(mp.to, s))
      if (on === exOn) return
      for (const [k, v] of Object.entries(mp.mults)) if (typeof P.mults[k] === 'number') P.mults[k] *= on ? v : 1 / v
      exOn = on
      P.updateSkillLevels()
    }
    const stanekStep = (t) => {
      multsPhaseStep(t)
      if (!stGift || t < stNext) return
      stNext = t + 60
      // the phase plan: the next phase's condition seen now lands lagS later (stanek.js's pass)
      if (stTrack) {
        const nx = stC.phases[stPhase + 1]
        if (nx && stDue === null && sp.whenHolds(nx.when, phaseState(t))) stDue = t + (stC.lagS ?? 300)
        if (nx && stDue !== null && t >= stDue) {
          stPhase++
          stDue = null
          stGift.placed = nx.placed
          stTrack.relay(nx.placed, t - stT0)
          stSwitches.push({ phase: stPhase, h: +(t / 3600).toFixed(3), ...phaseState(t) })
        }
        // THE CLOSED LOOP (o.stanek.decide, L3: tools/sim/stanekepoch.mjs): a controller reading this
        // world's state every gift step; a layout it returns lands lagS later (stanek.js's pass)
        if (stC.decide) {
          if (stPending && t >= stPending.at) {
            stGift.placed = stPending.placed
            stTrack.relay(stPending.placed, t - stT0)
            stSwitches.push({ phase: 'decide', h: +(t / 3600).toFixed(3), ...phaseState(t) })
            stPending = null
          }
          if (!stPending) {
            const nodes = goC ? (goC.perHour * (t - goT0)) / 3600 : 0
            const next = stC.decide({ t, P, bb: P.bladeburner ?? null, placed: stGift.placed, charges: stTrack.at(t - stT0), goEff, goNodes: nodes })
            if (Array.isArray(next) && !sp.sameLayout(stGift.placed.map((p) => ({ ...p, rotation: p.rot })), next)) {
              for (const p of next) if (!sp.canPlace(next.filter((q) => q !== p), stW, stH, p.x, p.y, p.rot, sp.fragmentById(p.id))) throw new Error(`bbsim o.stanek.decide: fragment ${p.id} at ${p.x},${p.y} r${p.rot} not placeable`)
              stPending = { placed: next, at: t + (stC.lagS ?? 300) }
            }
          }
        }
      }
      // an install clears every fragment's charge (CotMG/StaneksGift.ts:228-230 prestigeAugmentation): the charger restarts at stT0
      const nm = sp.layoutMults(stGift.placed, stTrack ? stTrack.at(t - stT0) : stC.chargeAt(t - stT0), stGift.nodePower)
      for (const [k, v] of Object.entries(nm)) if (typeof P.mults[k] === 'number' && v !== (stM?.[k] ?? 1)) P.mults[k] *= v / (stM?.[k] ?? 1)
      stM = nm
      P.updateSkillLevels()
    }
    applyMults()
    applyGift()
    P.updateSkillLevels()
    stanekStep(0)
    P.exp.intelligence = intelligence > 0 ? g.calculateExp(intelligence, 1) : 0
    P.exp.hacking = hacking > 1 ? g.calculateExp(hacking, P.mults.hacking * mults.HackingLevelMultiplier) : 0
    P.updateSkillLevels()
    P.money = 1e30 // money not binding (see header)
    const goStep = (t) => {
      if (!goC || t < goNext) return
      goNext = t + 60
      const e = gp.effectAt((goC.perHour * (t - goT0)) / 3600, goC.power ?? gp.OPPONENTS.Tetrads.power, goC.goPower ?? 1, goC.sf14 ?? 0)
      if (!(e > 0) || e === goEff) return
      for (const s of COMBAT) P.mults[s] *= e / goEff
      goEff = e
      P.updateSkillLevels()
    }

    // Before joining: the gym to 100 in every combat stat (joinBladeburnerDivision's gate).
    let t = 0
    const STEP = 3 // seconds: Sleeve.process uses at most 15 cycles per call (Sleeve.ts:269)
    // o.setup (a run from a LIVE state, tools/sim/bb14.mjs): the caller sets the
    // player's exp and multipliers, joins, and writes the division's state and the
    // fleet onto the game's objects; no join gym, no default fleet.
    // o.preJoinDuty (0..1, default 1): the share of the opening the work slot spends at the gym (the
    // rest on crime for the gym's fees, as the live openings do: history.jsonl currentWork) — the
    // start state's join time, set from the node's measured combat-100 time (tools/sim/bbboot.mjs).
    const preDuty = Math.min(1, Math.max(1e-3, o.preJoinDuty ?? 1))
    while (!o.setup && COMBAT.some((s) => P.skills[s] < 100) && t < 48 * 3600) {
      goStep(t)
      stanekStep(t)
      gymStep(P, 60 * preDuty)
      t += 60
    }
    const joinH = t / 3600
    P.startBladeburner()
    const bb = P.bladeburner
    for (const k of Object.keys(bb.logging)) bb.logging[k] = false // the console log is an unbounded array
    for (const a of [...Object.values(bb.contracts), ...Object.values(bb.operations)]) a.autoLevel = false
    if (o.setup) o.setup({ g, P, bb, faction })

    // The fleet as it arrives: Sleeve.prestige() — shock 100, exp 0, sync = memory (100).
    const nInf = pol.sleeves?.infiltrate ?? 0
    const nGym = pol.sleeves?.gym ?? 0
    const nSup = pol.sleeves?.support ?? 0
    const nFa = pol.sleeves?.fa ?? 0
    for (let i = 0; i < nInf + nGym + nSup + nFa; i++) {
      const s = new g.Sleeve()
      s.memory = 100
      s.prestige()
      P.sleeves.push(s)
    }
    // pol.sleevesFromH: the fleet idles until this many hours after the join (a replay of a
    // run whose sleeves were assigned late — BN6 2026-10-01/02, infiltrating only from 11:20Z).
    const sleevesFromS = (pol.sleevesFromH ?? 0) > 0 ? t + pol.sleevesFromH * 3600 : 0
    let fleetStarted = false
    const startFleet = () => P.sleeves.forEach((s, i) =>
      s.startWork(
        i < nInf
          ? new g.SleeveInfiltrateWork()
          : i < nInf + nSup
            ? new g.SleeveSupportWork()
            : i < nInf + nSup + nFa
              ? new g.SleeveBladeburnerWork({ actionId: { type: T.General, name: g.BladeburnerGeneralActionName.FieldAnalysis } })
              : new g.SleeveClassWork({ classType: g.GymType[gymStatsOf(pol.sleeves?.gymStats)[(i - nInf - nSup - nFa) % gymStatsOf(pol.sleeves?.gymStats).length]], location: GYM }),
      ),
    )
    if (o.setup) fleetStarted = true
    else if (sleevesFromS <= 0) {
      startFleet()
      fleetStarted = true
    }

    const gen = (name) => ({ type: T.General, name })
    const hrc = gen(g.BladeburnerGeneralActionName.HyperbolicRegen)
    const fa = gen(g.BladeburnerGeneralActionName.FieldAnalysis)
    const training = gen(g.BladeburnerGeneralActionName.Training)
    const diplomacy = gen(g.BladeburnerGeneralActionName.Diplomacy)
    let resting = false
    let lastSkillT = -Infinity
    let gymming = !!o.gymFirst // o.gymFirst: a retrain to pol.gymTo before acting (a live-start arm)
    let leg = null // the retrain's current gym class {stat, until}
    let installs = 0
    // THE PLAYER'S TRAINING (pol.train {stats, to, start, rest}): the work slot at the gym on the
    // lowest of `stats` — start: after the join, before the first action, to level `to`;
    // rest: instead of the rest action while stamina refills (the work slot is the action
    // slot: a class cancels the Bladeburner action without the Simulacrum, Bladeburner.ts:179,
    // :1355 — stamina still regenerates at its base rate, Bladeburner.ts:1376-1378, but not
    // the chamber's 1%/min, :1198-1203). With The Blade's Simulacrum installed (SF7.3 grants
    // it at the join, PlayerObjectBladeburnerMethods.ts:13-19; o.buySimulacrum buys it with
    // an install) the class runs BESIDE every action instead, and an install's retrain does not
    // block (bbplan.bladeExitGen gymParallel, the live model).
    const train = pol.train ?? null
    const trainStats = gymStatsOf(train?.stats)
    let startTrain = !!train?.start && !o.setup
    let restGym = false
    let simOn = (new Map(sf).get(7) ?? 0) >= 3 || o.simulacrum === true
    let nextInstall = every ? every * 3600 : Infinity
    const maxS = maxH * 3600
    const trace = []
    const gymTarget = () => Math.max(100, pol.gymTo ?? 100)

    // THE SHARED POLICY (pol.shared): bbplan.chooseAction / planSkills /
    // bestCity — the exact code bladeburner.js runs in the game — deciding on a
    // view built from the game's own objects, while every OUTCOME (success
    // rolls, rank, counts, chaos, events, sleeves) is still the game's.
    const sharedPol = { ...bp.POLICY, ...(pol.sharedPolicy ?? {}) }
    const viewOf = () => {
      // ENV in a reference city (population 1e9, no chaos); every real city
      // scales it by bbplan.cityFactor — the same split the daemon uses.
      const env = (a) => ({ int: P.skills.intelligence, stamina: bb.stamina, maxStamina: bb.maxStamina, pop: C.PopulationThreshold, chaos: 0, teamCount: a.teamCount ?? 0, augMult: P.mults.bladeburner_success_chance })
      const next = bb.blackOperationArray[bb.numBlackOpsComplete]
      return {
        person: P, sm: bb.skillMultipliers, levels: { ...bb.skills }, bnRank: g.currentNodeMults.BladeburnerRank, skillCostMult: g.currentNodeMults.BladeburnerSkillCost,
        rank: bb.rank, stamina: bb.stamina, maxStamina: bb.maxStamina, staminaGain: bb.calculateStaminaGainPerSecond(),
        maxStaminaBase: true, staminaBonus: bb.staminaBonus, resting,
        ref: { pop: C.PopulationThreshold, chaos: 0 },
        cities: Object.entries(bb.cities).map(([name, x]) => ({ name, pop: pol.useEst ? x.popEst : x.pop, chaos: x.chaos, comms: x.comms })),
        city: bb.city,
        actions: [...Object.values(bb.contracts), ...Object.values(bb.operations)].map((a) => {
          const d = bp.dataOf(a.name)
          return { d, count: a.count, maxLevel: a.maxLevel, K: bp.envOf(d, env(a)), width: 0 }
        }),
        blackOp: next ? { d: bp.dataOf(next.name), K: bp.envOf(bp.dataOf(next.name), env(next)), width: 0 } : null,
      }
    }
    const sharedDecide = () => {
      // Operations and black ops take the whole team (the daemon's setTeamSize).
      // pol.teamOps false: the team on black ops only (operations at 0, no casualties there).
      for (const a of Object.values(bb.operations)) a.teamCount = pol.teamOps === false ? 0 : bb.teamSize
      for (const a of bb.blackOperationArray) a.teamCount = bb.teamSize
      if (t - lastSkillT >= (pol.skillEveryS ?? bp.skillEveryOf(sharedPol, bb.numBlackOpsComplete, bb.rank) ?? 600)) {
        const plan = (pol.planSkills ?? bp.planSkills)(viewOf(), bb.skillPoints, sharedPol, g.currentNodeMults.BladeburnerSkillCost, sharedPol.skillChunks ?? 20, { t, bb, P })
        for (const b of plan) bb.upgradeSkill(b.name, b.count)
        lastSkillT = t
      }
      if (bb.stamina <= sharedPol.restLow * bb.maxStamina) resting = true
      if (resting && bb.stamina >= sharedPol.restHigh * bb.maxStamina) resting = false
      // pol.choose (a policy variant under test, tools/sim/bb14.mjs): wraps the shared chooser with the game's objects at hand.
      const pick = pol.choose ? pol.choose(viewOf(), sharedPol, { t, bb, P, g, resting }) : bp.chooseAction(viewOf(), sharedPol)
      if (pick.restAs) resting = pick.restAs === 'rest'
      if (pick.city) bb.city = pick.city
      restGym = !!train?.rest && !simOn && resting && pick.type === T.General && pick.name === g.BladeburnerGeneralActionName.HyperbolicRegen
      if (restGym) {
        if (bb.action) bb.resetAction()
        return
      }
      const id = { type: pick.type, name: pick.name }
      if (pick.level) bb.getActionObject(id).level = pick.level
      const cur = bb.action
      if (!cur || cur.type !== id.type || cur.name !== id.name) bb.startAction(id)
      else if (bb.actionTimeCurrent === 0) bb.actionTimeToComplete = bb.getActionObject(id).getActionTime(bb, P)
    }

    const decide = () => {
      if (pol.shared) return sharedDecide()
      if (t - lastSkillT >= 600) {
        spendSkills(bb, P, pol)
        lastSkillT = t
      }
      pickCity(bb, pol)
      const lowS = (pol.restLow ?? 0.55) * bb.maxStamina
      const highS = (pol.restHigh ?? 0.95) * bb.maxStamina
      if (bb.stamina <= lowS) resting = true
      if (resting && bb.stamina >= highS) resting = false
      let id = null
      const next = bb.blackOperationArray[bb.numBlackOpsComplete]
      if (resting) id = pol.rest === 'fa' ? fa : hrc
      else if (next && bb.rank >= next.reqdRank && next.getSuccessChance(bb, P, { est: false }) >= pol.blackThr) id = next.id
      else if (bb.getCurrentCity().chaos > C.ChaosThreshold) id = diplomacy
      else {
        const b = bestAction(bb, P, pol)
        if (b && pol.useEst && b.width > 0.2) id = fa // the shown range is wide: sharpen the estimate first
        else if (b) {
          b.a.level = b.L
          id = b.a.id
        } else if (pol.useEst) {
          // Deciding on ESTIMATED populations, nothing clears the bar: the
          // estimate may be what is wrong, and Field Analysis is what fixes it
          // (Bladeburner.ts completeAction FieldAnalysis ->
          // improvePopulationEstimateByPercentage). Training here deadlocked
          // (a run sat on Training for 250h at 137k rank, every estimate low).
          id = fa
        } else id = training
      }
      const cur = bb.action
      if (!cur || cur.type !== id.type || cur.name !== id.name) bb.startAction(id)
      else if (bb.actionTimeCurrent === 0) bb.actionTimeToComplete = bb.getActionObject(id).getActionTime(bb, P)
    }

    const install = () => {
      // What the node's economy bought this cycle (hackexit's g), then every
      // Bladeburners augmentation the faction's reputation covers
      // (repCost x AugmentationRepCost, AugmentationHelpers getAugCost).
      augMult *= Math.exp(growth * every)
      if (o.buyBladeAugs !== false) {
        for (const a of bladeburnerAugs()) {
          if (owned.has(a.name) || grafted.has(a.name) || !a.prereqs.every((p) => owned.has(p) || grafted.has(p))) continue
          if (faction.playerReputation >= a.repCost * mults.AugmentationRepCost) owned.add(a.name)
        }
      }
      // THE BLADE'S SIMULACRUM (o.buySimulacrum): bought with this install when the faction's
      // reputation covers it (Augmentations.ts:284 repCost 1.25e3 x AugmentationRepCost; its
      // $150b is not binding here, see the header). Installed, the player's work no longer
      // cancels the action (Bladeburner.ts:179, :1355): the gym runs beside it (pol.train).
      if (o.buySimulacrum && !simOn && faction.playerReputation >= 1.25e3 * mults.AugmentationRepCost) simOn = true
      faction.prestigeAugmentation() // rep -> favor (Faction.ts:77)
      // prestigeAugmentation resets EVERY exp (PlayerObjectGeneralMethods.ts:95-101) — charisma
      // too, which the contracts and Investigation/Undercover weigh 0.1-0.25. Hacking
      // stays the fixed input (the hacking scripts rebuild it within the life).
      for (const s of [...COMBAT, "charisma"]) P.exp[s] = 0
      // the install zeroes every opponent's node power (Go/Go.ts:34-47): the farm's effect leaves and regrows
      if (goC) {
        goEff = 1
        goT0 = t
        goNext = t
      }
      if (stGift) {
        stM = null // the charge is cleared: the layout's multipliers restart from none (Genesis stays)
        if (stTrack) stTrack.clear(t - stT0)
        stT0 = t
        stNext = t
      }
      applyMults()
      applyGift()
      P.updateSkillLevels()
      P.hp.current = P.hp.max
      bb.prestigeAugmentation() // resetAction + joinFaction (Bladeburner.ts:260)
      installs++
      gymming = !simOn // with the Simulacrum the retrain runs beside the actions (below)
      leg = null
      // The install restarts bladeburner.js, whose first pass spends at once
      // (on the reset stats) and starts its hourly clock there — as the exit
      // model's install does (bbplan bladeExitGen).
      if (pol.shared) {
        for (const b of bp.planSkills(viewOf(), bb.skillPoints, sharedPol, g.currentNodeMults.BladeburnerSkillCost, sharedPol.skillChunks ?? 20)) bb.upgradeSkill(b.name, b.count)
        lastSkillT = t
      }
    }

    const graftTick = () => {
      if (gRun && t >= gRun.endT) {
        grafted.add(gRun.name)
        if (gRun.name === 'violet Congruity Implant') {
          gStacks = 0
          gCongruity = true
        } else if (!gCongruity) gStacks++
        applyMults()
        applyGift()
        P.updateSkillLevels()
        gDone.push({ name: gRun.name, startH: +(gRun.startT / 3600).toFixed(3), endH: +(t / 3600).toFixed(3) })
        gRun = null
        if (!simOn) decide()
      }
      if (!gRun && gi < gr.schedule.length) {
        const name = gr.schedule[gi]
        const ga = new g.GraftableAugmentation(g.Augmentations[name])
        const need = ga.cost + (gr.fare ?? 2 * g.CONSTANTS.TravelCost)
        // gr.fromS: the schedule decided at that time (its wealth is that moment's): nothing starts before it
        const from = gr.fromS ?? 0
        if (t >= from && (gr.wealth ?? 0) + ((gr.moneyPerH ?? 0) * (t - from)) / 3600 - gSpent >= need) {
          gSpent += need
          gRun = { name, startT: t, endT: t + g.calculateGraftingTimeWithBonus(ga) / 1000 }
          gi++
          if (!simOn && bb.action) bb.resetAction() // the graft is the work: it cancels the action
        }
      }
    }
    const hashBuys = Array.isArray(o.hashBuys) ? [...o.hashBuys].sort((a, b) => a.tH - b.tH) : []
    let hashI = 0
    decide()
    while (t < maxS && bb.numBlackOpsComplete < bb.blackOperationArray.length) {
      if (t >= nextInstall) {
        if (gRun) gRun = null // the install cancels it (finishWork(true)); the price stays spent
        install()
        nextInstall += every * 3600
      }
      if (gr) graftTick()
      const slotGraft = !!gRun
      if (slotGraft) {
        if (!simOn && bb.action) bb.resetAction()
      } else if (gymming) {
        // THE RETRAIN AS progress.js RUNS IT (bbplan POLICY.retrainLegS): one
        // class per stat short of the bar, each held until a pass sees it
        // there — at least one pass long, the stat training on past the bar.
        if (bb.action) bb.resetAction()
        const legS = pol.retrainLegS ?? bp.POLICY.retrainLegS ?? 0
        if (!leg || (t >= leg.until && P.skills[leg.stat] >= gymTarget())) {
          const short = COMBAT.filter((s) => P.skills[s] < gymTarget())
          leg = short.length ? { stat: short.reduce((a, b) => (P.skills[b] < P.skills[a] ? b : a)), until: t + legS } : null
        }
        if (leg) gymStep(P, STEP, leg.stat)
        if (!leg) {
          gymming = false
          decide()
        }
      }
      if (slotGraft) {
        // the graft holds the work slot: no class (with the Simulacrum the action goes on)
      } else if (!gymming && startTrain) {
        // the start's training leg: the slot at the gym, no action, until every listed stat is at `to`
        if (bb.action) bb.resetAction()
        const s = lowestOf(P, trainStats, train.to ?? 100)
        if (s) gymStep(P, STEP, s)
        else {
          startTrain = false
          decide()
        }
      } else if (!gymming && (restGym || simOn)) {
        // resting at the gym, or the Simulacrum's class beside the action: the lowest listed stat below
        // the bar first (an install's retrain), then the lowest listed stat. pol.gymDuty (0..1, default
        // 1): the share of the time the class holds the body slot beside the actions — the slot lent to
        // other work (faction work, crime), as live BN13.3 did in its first hours (history.jsonl currentWork).
        const s = lowestOf(P, COMBAT, gymTarget()) ?? lowestOf(P, trainStats)
        const duty = restGym ? 1 : Math.min(1, Math.max(0, pol.gymDuty ?? 1))
        if (s && duty > 0) gymStep(P, STEP * duty, s)
      }
      // o.hashBuys ([{tH, kind: 'rank'|'sp'}], node hours): the hacknet's exchanges, replayed —
      // HacknetHelpers.tsx:539-555: changeRank(Player, 100) per rank level (no node multiplier;
      // skill points follow maxRank), +10 skill points per SP level (hashspend.js decides them live)
      while (hashI < hashBuys.length && t >= hashBuys[hashI].tH * 3600) {
        if (hashBuys[hashI].kind === 'rank') bb.changeRank(P, 100)
        else if (hashBuys[hashI].kind === 'sp') bb.skillPoints += 10
        hashI++
      }
      if (o.perTick) o.perTick({ t, P, bb, g })
      goStep(t)
      stanekStep(t)
      tick(bb, STEP)
      if (!fleetStarted && t >= sleevesFromS) {
        startFleet()
        fleetStarted = true
      }
      if (fleetStarted) for (const s of P.sleeves) s.process(STEP * 5)
      t += STEP
      if (bb.rank >= C.RankNeededForFaction && !faction.isMember) bb.joinFaction()
      if (!gymming && !startTrain && !(gRun && !simOn) && (!bb.action || bb.actionTimeCurrent === 0 || bb.actionTimeCurrent < STEP)) decide()
      if (o.onStep) o.onStep({ t, P, bb })
      if (t % 36000 < STEP) trace.push({ h: +(t / 3600).toFixed(1), rank: Math.round(bb.rank), bo: bb.numBlackOpsComplete, str: P.skills.strength, agi: P.skills.agility, augMult: +augMult.toFixed(2), bbAugs: owned.size })
    }
    const done = bb.numBlackOpsComplete >= bb.blackOperationArray.length
    const nextBO = bb.blackOperationArray[bb.numBlackOpsComplete]
    return {
      stuck: done ? null : {
        cities: Object.fromEntries(Object.entries(bb.cities).map(([k, c]) => [k, { pop: Math.round(c.pop), est: Math.round(c.popEst), comms: c.comms, chaos: +c.chaos.toFixed(1) }])),
        city: bb.city,
        actions: [...Object.values(bb.contracts), ...Object.values(bb.operations)].map((a) => ({ n: a.name, count: +a.count.toFixed(1), maxL: a.maxLevel, pEst1: +evAt(bb, P, a, 1, true).p.toFixed(3), pReal1: +evAt(bb, P, a, 1, false).p.toFixed(3) })),
        next: nextBO?.name, reqdRank: nextBO?.reqdRank, p: nextBO?.getSuccessChance(bb, P, { est: false }), sp: bb.skillPoints, stamina: bb.stamina, maxStamina: bb.maxStamina, action: bb.action?.name, resting },
      hours: done ? t / 3600 : null,
      joinH,
      rank: bb.rank,
      blackOps: bb.numBlackOpsComplete,
      installs,
      simulacrum: simOn,
      bbAugs: owned.size,
      augMult,
      ...(gr ? { grafts: { done: gDone, running: gRun?.name ?? null, notStarted: gr.schedule.slice(gi), spent: Math.round(gSpent), entropy: gStacks } } : {}),
      goEffect: goC ? +goEff.toFixed(4) : null,
      stanekSwitches: stTrack ? stSwitches : undefined,
      stanek: stM ? { strength: +(stM.strength * (genesis?.strength ?? 1)).toFixed(4), success: +stM.bladeburner_success_chance.toFixed(4), stamina: +stM.bladeburner_max_stamina.toFixed(4) } : null,
      skills: { ...bb.skills },
      stats: { ...P.skills },
      done,
      trace,
      why: done ? null : `not finished in ${maxH}h (rank ${Math.round(bb.rank)}, ${bb.numBlackOpsComplete}/21 black ops)`,
    }
  } finally {
    Math.random = saved
  }
}
