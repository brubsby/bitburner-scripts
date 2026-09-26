// THE BLADEBURNER EXIT, simulated by running the game's own Bladeburner.
//
// ---------------------------------------------------------------------------
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

import g, { setBitNode } from './game.mjs'

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

/** One step of the player at the gym on the lowest combat stat (Work/Formulas.ts:108 calculateClassEarnings, per cycle). */
function gymStep(P, seconds) {
  let low = COMBAT[0]
  for (const s of COMBAT) if (P.skills[s] < P.skills[low]) low = s
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
 *      sleeves: {infiltrate, gym}, useEst}, intelligence, hacking, seed, maxH }
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
    const applyMults = () => {
      P.resetMultipliers()
      P.reapplyAllSourceFiles()
      for (const s of COMBAT) P.mults[s] *= augMult
      for (const a of bladeburnerAugs()) if (owned.has(a.name)) for (const [k, v] of Object.entries(a.mults ?? {})) if (typeof P.mults[k] === 'number') P.mults[k] *= v
      P.updateSkillLevels()
    }
    applyMults()
    P.exp.intelligence = intelligence > 0 ? g.calculateExp(intelligence, 1) : 0
    P.exp.hacking = hacking > 1 ? g.calculateExp(hacking, P.mults.hacking * mults.HackingLevelMultiplier) : 0
    P.updateSkillLevels()
    P.money = 1e30 // money not binding (see header)

    // Before joining: the gym to 100 in every combat stat (joinBladeburnerDivision's gate).
    let t = 0
    const STEP = 3 // seconds: Sleeve.process uses at most 15 cycles per call (Sleeve.ts:269)
    while (COMBAT.some((s) => P.skills[s] < 100) && t < 48 * 3600) {
      gymStep(P, 60)
      t += 60
    }
    const joinH = t / 3600
    P.startBladeburner()
    const bb = P.bladeburner
    for (const k of Object.keys(bb.logging)) bb.logging[k] = false // the console log is an unbounded array
    for (const a of [...Object.values(bb.contracts), ...Object.values(bb.operations)]) a.autoLevel = false

    // The fleet as it arrives: Sleeve.prestige() — shock 100, exp 0, sync = memory (100).
    const nInf = pol.sleeves?.infiltrate ?? 0
    const nGym = pol.sleeves?.gym ?? 0
    for (let i = 0; i < nInf + nGym; i++) {
      const s = new g.Sleeve()
      s.memory = 100
      s.prestige()
      P.sleeves.push(s)
    }
    P.sleeves.forEach((s, i) => s.startWork(i < nInf ? new g.SleeveInfiltrateWork() : new g.SleeveClassWork({ classType: g.GymType[COMBAT[i % 4]], location: GYM })))

    const gen = (name) => ({ type: T.General, name })
    const hrc = gen(g.BladeburnerGeneralActionName.HyperbolicRegen)
    const fa = gen(g.BladeburnerGeneralActionName.FieldAnalysis)
    const training = gen(g.BladeburnerGeneralActionName.Training)
    const diplomacy = gen(g.BladeburnerGeneralActionName.Diplomacy)
    let resting = false
    let lastSkillT = -Infinity
    let gymming = false
    let installs = 0
    let nextInstall = every ? every * 3600 : Infinity
    const maxS = maxH * 3600
    const trace = []
    const gymTarget = () => Math.max(100, pol.gymTo ?? 100)

    const decide = () => {
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
          if (owned.has(a.name) || !a.prereqs.every((p) => owned.has(p))) continue
          if (faction.playerReputation >= a.repCost * mults.AugmentationRepCost) owned.add(a.name)
        }
      }
      faction.prestigeAugmentation() // rep -> favor (Faction.ts:77)
      for (const s of COMBAT) P.exp[s] = 0 // prestigeAugmentation resets exp (PlayerObjectGeneralMethods.ts)
      applyMults()
      P.hp.current = P.hp.max
      bb.prestigeAugmentation() // resetAction + joinFaction (Bladeburner.ts:260)
      installs++
      gymming = true
    }

    decide()
    while (t < maxS && bb.numBlackOpsComplete < bb.blackOperationArray.length) {
      if (t >= nextInstall) {
        install()
        nextInstall += every * 3600
      }
      if (gymming) {
        if (bb.action) bb.resetAction()
        gymStep(P, STEP)
        if (COMBAT.every((s) => P.skills[s] >= gymTarget())) {
          gymming = false
          decide()
        }
      }
      tick(bb, STEP)
      for (const s of P.sleeves) s.process(STEP * 5)
      t += STEP
      if (bb.rank >= C.RankNeededForFaction && !faction.isMember) bb.joinFaction()
      if (!gymming && (!bb.action || bb.actionTimeCurrent === 0 || bb.actionTimeCurrent < STEP)) decide()
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
      bbAugs: owned.size,
      augMult,
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
