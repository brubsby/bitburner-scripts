// bladeburner.js — the Bladeburner division, run to the 21st black operation.
//
// Every decision is bbplan.js (pure, 0GB): chooseAction, planSkills,
// cityFactor. This file only reads the game, applies the decision, and
// publishes /tel/bladeburner.txt. The same functions drive the game-physics
// simulator (tools/sim/nodechoice/bbsim.mjs, pol.shared) and the plan's exit
// model (bbplan.bladeExit), so what is simulated is what runs.
//
// ---------------------------------------------------------------------------
// WHAT IT NEVER DOES
//   - destroy w0r1d_d43m0n. Completing Operation Daedalus (black op 21) does
//     not end the node; destroyW0r1dD43m0n accepts after it
//     (Singularity.ts:1154-1158) and only endgame.js calls that, under its
//     --next and /endgame-hold.txt. This file publishes `exitReady: true` and
//     stops there.
//   - take the work slot. A Bladeburner action and Player.currentWork are
//     exclusive both ways: startAction calls Player.finishWork
//     (Bladeburner.ts:179-181) and Bladeburner.process resets the action
//     whenever currentWork is set (Bladeburner.ts:1353-1366). So it acts ONLY
//     while progress.js publishes slot.owner === 'bladeburner' in a fresh
//     /tel/progress.txt from this life ([bitburner-work-slot]: one slot, two
//     claimants, defer on slot.owner). Skill points are spent either way —
//     they need no slot.
//
// ---------------------------------------------------------------------------
// THE ENV PROBE (bbplan.js header): one getActionEstimatedSuccessChance per
// action, at its max level, in the current city. Every operation shares one
// ENV (int x stamina x augs x team x population/chaos), every contract another
// (no team term), so the largest unclamped probe of each family is exact and
// every other city, level and skill purchase follows in closed form
// (bbplan.cityFactor, pFrom). The policy decides on the LOW end of the range
// the API shows (Action.ts:85-108), which carries the population-estimate
// error, and does Field Analysis when that range is wide.
//
// CALIBRATION, published every pass because the model behind the plan's
// route decision has never seen a live Bladeburner: the formula's action time
// against getActionTime, the formula's max stamina against getStamina, and the
// observed success rate of the last attempts against the chance the policy
// expected. tools/healthcheck.mjs reads them.
//
// ---------------------------------------------------------------------------
// RAMOVERRIDE 3.25GB — excludes: the whole ns.bladeburner.* surface (4GB per
// call, NOT scaled by Source-File 4 — RamCostGenerator.ts applies SF4Cost only
// to the singularity namespace) and ns.getPlayer.
//
// 3.25 = RamCostConstants.Base (1.6) + getResetInfo (1.0) + scp (0.6) +
// getHostname (0.05): everything called before the capability decision.
// When Bladeburner is possible the allocation is raised to the file's FULL
// static price through ramgrow.js, which reports a denied raise loudly
// (NetscriptFunctions.ts:1210-1214 denies silently). Asserted by
// tools/test/ramoverride.test.mjs [R1..R5]; registered in tools/sim/bncheck.mjs.

import { canJoinBladeburner } from 'sfgate.js'
import { slotClaim as slotClaimHere, SLOT_FILES } from 'bbslot.js'
import { liteAliveOf } from 'bbliteplan.js'
import { reporter, describe, record } from 'status.js'
import { raiseRam } from 'ramgrow.js'
import { bitNodeMults } from 'bitNodeMultipliers.js'
import { BBC, TYPE, GENERAL, LEVELED, CONTRACTS, OPERATIONS, BLACK_OPS, SKILLS, POLICY, JOIN_COMBAT, DAEDALUS, CITY_NAMES, dataOf, typeOf, skillMultsOf, envFromChance, chooseAction, planSkills, actionTime, envOf, maxStaminaOf, staminaGainOf, staminaBonusOf, pFrom, bestCity, successChance, popRatioFromRange, popRatioFromRanges, unreadPopOf, anchorAfter, POP_PROBE, rankGainOf, rankLossOf, successPosterior, attemptsOf, COUNT_TWIN, SUCCESS_CAL, joinedAtOf, divisionCarryOf } from 'bbplan.js'

const STATUS = '/tel/bladeburner.txt'
/** bb-lite.js's heartbeat: while it is alive this daemon does not act (the handover, bbliteplan.liteAliveOf). */
const LITE = '/tel/bb-lite.txt'
/** Full static price, measured by the game's calculator ([R5]); no ns.singularity, so no `* mult` term. */
const RAISE_CEILING = (mult) => 92.75 + 0 * mult
/** How long a refused raise keeps asking before exiting to the watchdog (ramgrow.raiseRam tries x gapMs: 10 min). */
export const RAISE_WAIT = { tries: 40, gapMs: 15e3 }

export async function main(ns) {
  ns.ramOverride(3.25)

  const rerrors = []
  // THE DIVISION RIDES ON EVERY RECORD (bbplan.divisionCarryOf): the last full
  // read of this node's division, so a record that does not read it (waiting
  // on the slot, a refused raise, stopped) never erases what the plan prices
  // and what the next start carries (calibration, joinedAt). Seeded below
  // from the record on disk; operate() refreshes it on every full publish.
  const carry = { rec: {} }
  const note = reporter(ns, STATUS, () => ({ ...carry.rec, errors: rerrors.slice(-5) }))
  // The daemon mirrors /tel/* from HOME only, and boot.js places this script
  // 'anywhere': push every write to home or it is never seen ([bitburner-offhome-reads]).
  const host = ns.getHostname()
  const mirror = () => {
    try {
      if (host !== 'home') ns.scp(STATUS, 'home', host)
    } catch {
      /* home unreachable; the local copy still stands */
    }
  }
  const say = (health, fields) => {
    const body = note(health, fields)
    mirror()
    return body
  }
  ns.atExit(() => {
    note.exit('stopped', { detail: 'bladeburner.js exited' })
    mirror()
  })

  const info = ns.getResetInfo()
  try {
    if (host !== 'home') ns.scp(STATUS, host, 'home')
    carry.rec = divisionCarryOf(JSON.parse(ns.read(STATUS) || 'null'), info.currentNode)
  } catch {
    carry.rec = {}
  }
  if (!canJoinBladeburner(info)) {
    say('waiting', {
      result: 'capability-absent',
      bitNode: info.currentNode,
      lastAugReset: info.lastAugReset,
      gate: 'canJoinBladeburner',
      needs: 'BitNode 6 or 7, or Source-File 6 or 7 (and Bladeburner not disabled by the node options)',
      detail: 'No Bladeburner in this node (NetscriptFunctions/Bladeburner.ts:35, :331-342). Staying at the 3.25GB floor and exiting.',
    })
    return
  }
  const mults = bitNodeMults(info.currentNode)
  if (!mults || !(mults.BladeburnerRank > 0)) {
    say('waiting', { result: 'disabled-in-node', bitNode: info.currentNode, lastAugReset: info.lastAugReset, detail: `BladeburnerRank ${mults?.BladeburnerRank} in BitNode ${info.currentNode}: the division is disabled here (Bladeburner.ts:339-342).` })
    return
  }

  // A refused raise is usually boot's crowd on a fresh life's home: keep asking
  // at the 3.25GB floor for RAISE_WAIT.tries x gapMs (the watchdog relaunches
  // only every few minutes — live BN14.1 the division went unread 01:32-01:40Z),
  // and carry the record through the refusal (ramgrow carry).
  if (!(await raiseRam(ns, RAISE_CEILING(1), STATUS, 'bladeburner.js needs its full allocation before the first ns.bladeburner call', RAISE_WAIT.tries, RAISE_WAIT.gapMs, { carry: true }))) {
    mirror()
    return
  }

  try {
    await operate(ns, say, info, mults, carry)
  } catch (err) {
    ns.print(record(rerrors, err))
    say('error', { result: 'error', bitNode: info.currentNode, lastAugReset: info.lastAugReset, detail: describe(err) })
    throw err
  }
}

/**
 * The work-slot claim (bbslot.slotClaim: progress.js's, else act.js's
 * bootstrap claim), read from home: ns.read is local to this host, so the
 * files are pulled first ([bitburner-offhome-reads]).
 */
export function slotClaim(ns, host, info) {
  try {
    if (host !== 'home') ns.scp(SLOT_FILES, host, 'home')
  } catch {
    /* fall through to whatever copy is here; its age decides */
  }
  return slotClaimHere(ns, host, info)
}

async function operate(ns, say, info, mults, carry = { rec: {} }) {
  const bb = ns.bladeburner
  const host = ns.getHostname()
  const flags = ns.flags([
    ['own-slot', false], // testing only: act without progress.js's claim
  ])
  const bnRank = mults.BladeburnerRank
  const costMult = mults.BladeburnerSkillCost
  const base = { bitNode: info.currentNode, lastAugReset: info.lastAugReset, host, daemon: 'bladeburner.js' }

  let resting = false
  let city = null
  let lastSkills = 0
  const autoOff = new Set()
  const samples = [] // {t, rank, stamina, maxStamina} once a minute, the last hour
  const outcomes = [] // {name, level, p, n, s} per read: the attempts since the last read (bbplan.attemptsOf)
  let obs = null // what the last pass left running: {name, level, p, count, twin, rank}
  let unmeasured = null // the last interval attemptsOf could not attribute, and why
  let teamSet = -1
  const purchases = []
  // THE SUCCESS CALIBRATION survives a restart: the groups this script
  // published last (same node), so the evidence keeps growing.
  let calGroups = []
  // The division's age rides on the record (bbplan.joinedAtOf): the exit model prices unread inputs at it.
  let prevRec = null
  let joinedAt = null
  try {
    // From home: this script mirrors its record there, and a restart may land on another host.
    if (host !== 'home') ns.scp(STATUS, host, 'home')
  } catch {
    /* the copy here, if any */
  }
  // THE POPULATION ANCHORS (bbplan.unreadPopOf): each city's last true read
  // {pop, comms}, for a city whose estimate has collapsed so its range can no
  // longer show it. Carried on the record across restarts (same node).
  const anchors = {}
  try {
    const prev = JSON.parse(ns.read(STATUS) || 'null')
    prevRec = prev
    if (prev?.bitNode === info.currentNode && Array.isArray(prev?.cities)) {
      for (const c of prev.cities) {
        if (c?.anchor && c.anchor.pop > 0) anchors[c.name] = { ...c.anchor }
        if (c?.r != null && c.pop > 0) anchors[c.name] = { pop: c.pop, comms: c.comms }
      }
    }
    if (prev?.bitNode === info.currentNode && Array.isArray(prev?.calibration?.success?.groups)) calGroups = prev.calibration.success.groups.filter((g) => g && g.p > 0 && g.n > 0)
  } catch {
    calGroups = []
  }
  let calVer = 0
  let calDone = -1
  let sCalMemo = null
  const addGroup = (name, level, p, n, sN) => {
    calVer++
    const pr = +p.toFixed(3)
    const g = calGroups.find((x) => x.name === name && x.level === level && x.p === pr)
    if (g) {
      g.n += n
      g.s += sN
    } else calGroups.push({ name, level, p: pr, n, s: sN })
    // Keep the newest SUCCESS_CAL.keep attempts (oldest groups go first).
    let tot = calGroups.reduce((a, x) => a + x.n, 0)
    while (calGroups.length > 1 && tot - calGroups[0].n >= SUCCESS_CAL.keep) tot -= calGroups.shift().n
  }

  for (;;) {
    // ---- 0. the handover from bb-lite.js ----------------------------------
    // bb-lite.js acts with a lean surface until a host holds this daemon's
    // 92.75GB. While it is alive (bbliteplan.liteAliveOf on /tel/bb-lite.txt)
    // nothing here acts — no start, no stop, no skill — so there is never a
    // second actor. It sees this record (daemon 'bladeburner.js', result
    // 'handover-wait') and exits; the watchdog also stops it once this
    // daemon is running. The game keeps repeating its last action meanwhile
    // (Bladeburner.processAction :1313), so the slot never goes idle.
    {
      try {
        if (host !== 'home') ns.scp(LITE, host, 'home')
      } catch {
        /* the copy here, if any; its age decides */
      }
      let liteRec = null
      try {
        liteRec = JSON.parse(ns.read(LITE) || 'null')
      } catch {
        liteRec = null
      }
      const lite = liteAliveOf(liteRec, info, Date.now())
      if (lite.alive) {
        say('waiting', { ...base, result: 'handover-wait', joined: bb.inBladeburner(), lite: lite.why, detail: `bb-lite.js is acting (${lite.why}); not acting until it stands down` })
        await ns.sleep(10e3)
        continue
      }
    }
    // ---- 1. in the division? -------------------------------------------
    if (!bb.inBladeburner()) {
      const p = ns.getPlayer()
      const combat = { strength: p.skills.strength, defense: p.skills.defense, dexterity: p.skills.dexterity, agility: p.skills.agility }
      const low = Math.min(...Object.values(combat))
      if (low >= JOIN_COMBAT) {
        const ok = bb.joinBladeburnerDivision()
        // Read the state back, not the return value.
        if (!bb.inBladeburner()) {
          say('error', { ...base, result: 'join-refused', joined: false, combat, detail: `joinBladeburnerDivision returned ${ok} with every combat stat >= ${JOIN_COMBAT}, and inBladeburner() is still false — the reason is in this script's log.` })
          await ns.sleep(60e3)
          continue
        }
      } else {
        say('waiting', { ...base, result: 'not-joined', joined: false, combat, need: JOIN_COMBAT, detail: `the division needs every combat stat >= ${JOIN_COMBAT} (NetscriptFunctions/Bladeburner.ts:347-352); lowest is ${low}. progress.js trains it as a body leg when the plan commits the Bladeburner route.` })
        await ns.sleep(60e3)
        continue
      }
    }

    // ---- 2. read the game ------------------------------------------------
    const rank = bb.getRank()
    let factionJoined = null
    if (rank >= BBC.RankNeededForFaction) factionJoined = bb.joinBladeburnerFaction()
    const player = ns.getPlayer()
    const person = { skills: { ...player.skills }, mults: { ...player.mults } }
    const levels = {}
    for (const name of Object.keys(SKILLS)) levels[name] = bb.getSkillLevel(name)
    const [stamina, maxStamina] = bb.getStamina()
    const team = bb.getTeamSize()
    if (team !== teamSet) {
      // Operations and black ops take the whole team (supporting sleeves count, Bladeburner.ts:101-103).
      for (const d of [...Object.values(OPERATIONS), ...BLACK_OPS]) bb.setTeamSize(typeOf(d), d.name, team)
      teamSet = team
    }
    // THE TRUE POPULATION OF EVERY CITY (bbplan.popRatioFromRange): the
    // hardest black op's shown range in each city is [p*r, p] or [p, p*r],
    // r = pop / popEst, and p is the formula's (no city term). switchCity is
    // free and instant and nothing ticks inside this synchronous block, so
    // the running action never sees another city; the current one is set
    // back below. `pop` null: the range could not say (an end clamped).
    const smNow = skillMultsOf(levels)
    const probeD = dataOf(POP_PROBE)
    const probeP = successChance(probeD, 1, person, smNow, { int: person.skills.intelligence ?? 0, stamina, maxStamina, teamCount: team, augMult: person.mults.bladeburner_success_chance ?? 1 })
    const cities = CITY_NAMES.map((name) => {
      bb.switchCity(name)
      const popEst = bb.getCityEstimatedPopulation(name)
      const [lo, hi] = bb.getActionEstimatedSuccessChance(TYPE.blackOp, POP_PROBE)
      // The side from a city-dependent action's own range (popRatioFromRanges), the formula's chance where none reads.
      let r = null
      for (const [tp, nm] of [[TYPE.operation, 'Assassination'], [TYPE.contract, 'Tracking'], [TYPE.contract, 'Retirement']]) {
        const [cl, ch] = bb.getActionEstimatedSuccessChance(tp, nm)
        r = popRatioFromRanges(lo, hi, cl, ch)
        if (r !== null) break
      }
      if (r === null) r = popRatioFromRange(lo, hi, probeP)
      const comms = bb.getCityCommunities(name)
      const pop = r === null ? null : popEst * r
      if (pop !== null && pop > 0) anchors[name] = { pop, comms }
      return { name, popEst, pop, r, popFrom: pop === null ? null : 'range', chaos: bb.getCityChaos(name), comms }
    })
    // An unreadable city (r null — the estimate collapsed under Raid's equal
    // shifts, bbplan.unreadPopOf): its anchor carried by the communities
    // consumed since, else a typical city; never the collapsed estimate.
    const readable = cities.filter((c) => c.pop !== null).map((c) => c.pop)
    for (const c of cities) {
      if (c.pop !== null) continue
      const u = unreadPopOf(c, anchors[c.name] ?? null, readable)
      if (u) {
        c.pop = u.pop
        c.popFrom = u.from
      }
    }
    // The policy and the model decide on the TRUE population where it is known.
    const truePop = (c) => (c.pop !== null && c.pop >= 0 ? c.pop : c.popEst)
    if (!city) city = bestCity(cities.map((c) => ({ ...c, pop: truePop(c) }))).name
    bb.switchCity(city) // where the probes are read; getCity is not paid for, so the daemon always sets it

    const readEnv = () => {
      const sm = skillMultsOf(levels)
      const here = cities.find((c) => c.name === city)
      // r known: one end of every action's range is its chance at the
      // ESTIMATE (r < 1: the high end; r > 1: the low end, Action.ts:144-167),
      // so ENV at popEst is exact, and with the cities at their true
      // populations cityFactor gives the REAL chance — what the game rolls.
      // r unknown: the low end, as before, and the width says how unsure.
      // HERE UNREADABLE (a collapsed estimate, popFrom anchor/median): the
      // ranges here say nothing (an estimate of ~0 puts every low end at ~0),
      // so ENV is read in the largest city whose r is known — ENV is the same
      // in every city but for population and chaos, which cityFactor carries
      // (bbdaemon [BD6]). switchCity is free and instant; back below.
      const readable = here.r === null && here.popFrom ? cities.filter((c) => c.r !== null).sort((a, b) => b.pop - a.pop)[0] ?? null : null
      const ref = readable ?? here
      if (readable) bb.switchCity(ref.name)
      const rCur = ref.r
      let Kc = 0
      let Ko = 0
      let KcLo = 0
      let KoLo = 0
      let KcClamp = 0
      let KoClamp = 0
      const actions = []
      for (const d of LEVELED) {
        const type = typeOf(d)
        if (!autoOff.has(d.name)) {
          bb.setActionAutolevel(type, d.name, false)
          autoOff.add(d.name)
        }
        const count = bb.getActionCountRemaining(type, d.name)
        const maxLevel = bb.getActionMaxLevel(type, d.name)
        bb.setActionLevel(type, d.name, maxLevel)
        const [lo, hi] = bb.getActionEstimatedSuccessChance(type, d.name)
        const est = rCur === null ? lo : rCur < 1 ? hi : lo
        if (!(d.name === 'Raid' && ref.comms < 1)) {
          // Every action of a family shares one ENV: the largest unclamped read is exact.
          if (est < 0.999) {
            const K = envFromChance(est, d, maxLevel, person, sm)
            if (d.kind === 'contract') Kc = Math.max(Kc, K)
            else Ko = Math.max(Ko, K)
          } else {
            // Clamped at the max level: the chance there is >= 0.999, a lower bound on ENV.
            const K = envFromChance(0.999, d, maxLevel, person, sm)
            if (d.kind === 'contract') KcClamp = Math.max(KcClamp, K)
            else KoClamp = Math.max(KoClamp, K)
          }
          const K0 = envFromChance(lo, d, maxLevel, person, sm)
          if (d.kind === 'contract') KcLo = Math.max(KcLo, K0)
          else KoLo = Math.max(KoLo, K0)
        }
        actions.push({ d, count, maxLevel, width: rCur === null ? hi - lo : 0 })
      }
      if (readable) bb.switchCity(city)
      // EVERY ESTIMATE CLAMPED (a strong player): no read pins ENV. It was the
      // low end — in a city whose estimate is 3x its population (r 0.32) that
      // is ~1/10 of ENV: live 2026-10-05 00:26Z the daemon ran Raid L4 'at
      // 42%' (operations K 0.185, contracts 0.028) where the game rolls Raid
      // L26 at 100% (the formula's K 1.785 / 1.632 in Volhaven at its
      // estimate) — ~1/3 of the rank rate the model and the game's classes
      // play (live 5.7k/h vs ~15k/h simulated from that state). Now the
      // formula's ENV at the reference's estimate: every factor of the chance
      // is read here (stats, skills, int, stamina, team, augs) but the
      // population, which is the estimate the range is built on — never below
      // what the clamp proves (>= 0.999 at the max level) or the low end.
      // NOT applied: the success calibration k (measured on exact reads only).
      const envRef = { int: person.skills.intelligence ?? 0, stamina, maxStamina, teamCount: team, augMult: person.mults.bladeburner_success_chance ?? 1, pop: ref.popEst, chaos: ref.chaos }
      const exact = { contracts: Kc > 0, operations: Ko > 0 }
      if (!(Kc > 0)) Kc = Math.max(KcLo, KcClamp, envOf(CONTRACTS.Tracking, envRef))
      if (!(Ko > 0)) Ko = Math.max(KoLo, KoClamp, envOf(OPERATIONS.Investigation, envRef))
      for (const a of actions) a.K = a.d.kind === 'contract' ? Kc : Ko
      const next = bb.getNextBlackOp()
      let blackOp = null
      if (next) {
        const d = dataOf(next.name)
        const [lo, hi] = bb.getActionEstimatedSuccessChance(TYPE.blackOp, next.name)
        // A black op's real chance is its estimated one (no city term): the end the formula names.
        const pF = successChance(d, 1, person, sm, { int: person.skills.intelligence ?? 0, stamina, maxStamina, teamCount: team, augMult: person.mults.bladeburner_success_chance ?? 1 })
        const p = Math.abs(hi - pF) <= Math.abs(lo - pF) ? hi : lo
        blackOp = { d, K: envFromChance(p, d, 1, person, sm), width: 0, lo, hi }
      }
      return {
        person, sm, levels, bnRank, skillCostMult: costMult, rank, stamina, maxStamina,
        // maxStaminaBase: the skill planner re-derives max stamina and its
        // regeneration under a candidate purchase (Cyber's Edge) from the
        // formula plus Training's bonus read back out of the game. False, a
        // stamina skill moved nothing and was never bought (live 13:22Z:
        // Cyber's Edge 0 while stamina held the player to ~42% acting).
        staminaGain: staminaGainOf(person, sm, maxStamina), maxStaminaBase: true, staminaBonus: staminaBonusOf(person, sm, maxStamina),
        resting, ref: { pop: ref.popEst, chaos: ref.chaos }, cities: cities.map((c) => ({ name: c.name, pop: rCur === null ? c.popEst : truePop(c), chaos: c.chaos, comms: c.comms })), city, actions, blackOp,
        K: { contracts: Kc, operations: Ko },
        Kexact: exact,
      }
    }

    // ---- 3. skills: no slot needed ----------------------------------------
    let sp = bb.getSkillPoints()
    // On the model's cadence (POLICY.skillEveryS, chunks POLICY.skillChunks): the exit prices this policy,
    // on this clock (skillsAt: the model's hourly spends fall where these do).
    if (sp >= 1 && Date.now() - lastSkills > POLICY.skillEveryS * 1000) {
      const v = readEnv()
      for (const b of planSkills(v, sp, POLICY, costMult, POLICY.skillChunks)) {
        const before = bb.getSkillLevel(b.name)
        bb.upgradeSkill(b.name, b.count)
        const after = bb.getSkillLevel(b.name)
        purchases.push({ at: new Date().toISOString(), name: b.name, count: b.count, cost: b.cost, got: after - before, why: b.why })
        if (after !== before + b.count) break // the game disagreed (cost or cap): stop and re-read next pass
        levels[b.name] = after
      }
      while (purchases.length > 20) purchases.shift()
      sp = bb.getSkillPoints()
      lastSkills = Date.now()
    }

    // ---- 4. the decision ---------------------------------------------------
    if (stamina <= POLICY.restLow * maxStamina) resting = true
    if (resting && stamina >= POLICY.restHigh * maxStamina) resting = false
    let v = readEnv()
    // ---- what the last interval did (bbplan.attemptsOf): attempts from the
    // worked action's count against its growth twin's, successes from the rank.
    if (obs) {
      const d0 = dataOf(obs.name)
      const twin = COUNT_TWIN[obs.name]
      const cnt = (n) => v.actions.find((a) => a.d.name === n)?.count
      const a = twin ? attemptsOf({ d: d0, level: obs.level, bnRank, count0: obs.count, count1: cnt(obs.name), twin0: obs.twin, twin1: cnt(twin), rank0: obs.rank, rank1: rank }) : { n: null, why: `${obs.name} has no growth twin` }
      if (a.n > 0 && obs.p > 0) {
        outcomes.push({ name: obs.name, level: obs.level, p: obs.p, n: a.n, s: a.s })
        // Our own attempts move the population the anchor carries (bbplan.anchorAfter).
        if (obs.city && anchors[obs.city]) anchors[obs.city] = anchorAfter(anchors[obs.city], obs.name, a.n, a.s)
        while (outcomes.length > 60) outcomes.shift()
        // The calibration only where the chance can say something: a predicted
        // ~1 is often a clamped estimate (ENV a lower bound), and its successes
        // would push k up on nothing (bbdaemon [BD5]).
        // ...and only where the chance was the REAL one (the population read: obs.exact); on the
        // low end of an unread range it is a lower bound and would push k up on nothing.
        if (+obs.p.toFixed(3) < SUCCESS_CAL.maxP && obs.exact) addGroup(obs.name, obs.level, obs.p, a.n, a.s)
      } else if (a.n === null) unmeasured = { name: obs.name, why: a.why }
      obs = null
    }
    let pick = chooseAction(v, POLICY)
    if (pick.city && pick.city !== city) {
      // Another city prices better: move (free and instant) and decide again on its own probes.
      city = pick.city
      bb.switchCity(city)
      v = readEnv()
      pick = chooseAction(v, POLICY)
      // Still pointing elsewhere: the new probe disagrees with the old city's
      // estimate. Act HERE, on what was just measured here, and let the next
      // pass move again if it still prices better.
      if (pick.city && pick.city !== city) pick = chooseAction({ ...v, cities: v.cities.filter((c) => c.name === city) }, POLICY)
    }
    const slot = flags['own-slot'] ? { owner: 'bladeburner', ours: true, why: '--own-slot (testing): acting without a claim' } : slotClaim(ns, host, info)
    const exitReady = !v.blackOp

    // The model check: the formula's numbers against the game's own.
    const d = pick.type === TYPE.general ? null : dataOf(pick.name)
    const level = pick.level ?? 1
    const calib = {
      timeFormulaS: d ? actionTime(d, level, person, v.sm) : null,
      timeGameS: null,
      maxStaminaFormula: +maxStaminaOf(person, v.sm, 0).toFixed(3),
      maxStaminaGame: +maxStamina.toFixed(3),
    }

    let started = null
    let current = bb.getCurrentAction()
    if (slot.ours && !exitReady) {
      if (d && d.kind !== 'blackop') bb.setActionLevel(pick.type, pick.name, level)
      // Probes moved every level; put the running action back at the chosen level if it is the same action.
      const same = current && current.type === pick.type && current.name === pick.name
      // RE-READ THE CLAIM IMMEDIATELY BEFORE startAction: it ends the
      // player's work first (Bladeburner.ts:179-181), so it runs only on a
      // claim read at this moment, never on the one this pass began with.
      const recheck = !same && !flags['own-slot'] ? slotClaim(ns, host, info) : slot
      if (!same && !recheck.ours) {
        say('waiting', { ...base, result: 'slot-not-ours', joined: true, rank, slot: recheck, detail: `not starting ${pick.name}: ${recheck.why}` })
        await ns.sleep(10e3)
        continue
      }
      if (!same) {
        started = bb.startAction(pick.type, pick.name)
        current = bb.getCurrentAction()
        if (!current || current.name !== pick.name) {
          say('error', { ...base, result: 'start-refused', joined: true, rank, action: pick, slot, detail: `startAction("${pick.type}", "${pick.name}") returned ${started} and the game is running ${current?.name ?? 'nothing'} — the reason is in this script's log (Bladeburner.ts:183-186).` })
          await ns.sleep(10e3)
          continue
        }
      }
      if (d) {
        calib.timeGameS = bb.getActionTime(pick.type, pick.name) / 1000 // ms (NetscriptFunctions/Bladeburner.ts:125-130)
        // What runs until the next read: its counters now (bbplan.attemptsOf reads the change).
        const twin = COUNT_TWIN[pick.name]
        const cnt = (n) => v.actions.find((a) => a.d.name === n)?.count
        if (d.kind !== 'blackop' && twin && pick.p > 0) obs = { name: pick.name, level, p: pick.p, city, exact: cities.find((c) => c.name === city)?.r != null && v.Kexact?.[d.kind === 'contract' ? 'contracts' : 'operations'] === true, count: cnt(pick.name), twin: cnt(twin), rank }
      }
    } else if (!slot.ours) {
      // Not ours: nothing of ours may run. (The probes above moved every
      // action's level, so a leftover action would also be at the wrong one.)
      if (current) {
        bb.stopBladeburnerAction()
        current = bb.getCurrentAction()
      }
    }

    // ---- 5. publish --------------------------------------------------------
    const now = Date.now()
    if (!samples.length || now - samples[samples.length - 1].t >= 60e3) {
      samples.push({ t: now, rank: +rank.toFixed(2), stamina: +stamina.toFixed(2), maxStamina: +maxStamina.toFixed(2) })
      while (samples.length > 61) samples.shift()
    }
    const hourAgo = samples.find((s) => now - s.t <= 3600e3) ?? samples[0]
    const rankPerHour = samples.length > 1 && now > hourAgo.t ? ((rank - hourAgo.rank) / (now - hourAgo.t)) * 3600e3 : null
    // The last >= 20 measured ATTEMPTS (a read can span several).
    const recent = []
    let rn = 0
    for (let i = outcomes.length - 1; i >= 0 && rn < 20; i--) {
      recent.unshift(outcomes[i])
      rn += outcomes[i].n
    }
    const rs = recent.reduce((a, o) => a + o.s, 0)
    const observed = rn ? rs / rn : null
    const expected = rn ? recent.reduce((a, o) => a + o.n * o.p, 0) / rn : null
    // Re-computed only when an attempt was added (a 121-point grid over every group: ~1-3ms).
    if (calVer !== calDone) {
      sCalMemo = successPosterior(calGroups)
      calDone = calVer
    }
    const sCal = sCalMemo
    const bo = v.blackOp
    const full = say(exitReady ? 'ok' : slot.ours ? 'ok' : 'waiting', {
      ...base,
      result: exitReady ? 'exit-ready' : slot.ours ? (started === null ? 'acting' : 'started') : 'slot-not-ours',
      joined: true,
      joinedAt: (joinedAt ??= joinedAtOf(prevRec, info.currentNode, true)),
      factionJoined,
      rank: +rank.toFixed(2),
      rankPerHour: rankPerHour === null ? null : +rankPerHour.toFixed(2),
      skillPoints: sp,
      levels,
      stamina: +stamina.toFixed(2),
      maxStamina: +maxStamina.toFixed(2),
      resting,
      city,
      team,
      slot,
      action: { type: pick.type, name: pick.name, level: pick.level ?? null, city: pick.city ?? city, p: pick.p ?? null, ev: pick.ev ?? null, why: pick.why },
      running: current ? { type: current.type, name: current.name } : null,
      blackOps: {
        done: bo ? bo.d.n : BLACK_OPS.length,
        next: bo ? bo.d.name : null,
        reqdRank: bo ? bo.d.reqdRank : null,
        chance: bo ? [+bo.lo.toFixed(4), +bo.hi.toFixed(4)] : null,
        formulaChance: bo ? +pFrom(bo.K, bo.d, 1, person, v.sm).toFixed(4) : null,
        // The attempt rule (bbplan.blackOpWorth under POLICY.blackRule 'priced'): its verdict this pass, attempted or held.
        rule: POLICY.blackRule ?? 'threshold',
        verdict: pick.blackOp ? pick.why : pick.blackHeld ? `held: ${pick.blackHeld.why}` : bo && rank < bo.d.reqdRank ? `rank ${Math.round(rank)} < ${bo.d.reqdRank}` : null,
        pStar: pick.blackOp ? (pick.worth?.pStar ?? null) : (pick.blackHeld?.pStar ?? null),
      },
      exitReady,
      exitNote: exitReady ? `all 21 black ops complete (${DAEDALUS} done): destroyW0r1dD43m0n now accepts with no hacking level (Singularity.ts:1154-1158). endgame.js does it under its --next and /endgame-hold.txt; this script never will.` : null,
      env: { contracts: v.K.contracts, operations: v.K.operations, exact: v.Kexact },
      counts: Object.fromEntries(v.actions.map((a) => [a.d.name, +a.count.toFixed(1)])),
      maxLevels: Object.fromEntries(v.actions.map((a) => [a.d.name, a.maxLevel])),
      // pop: the TRUE population read off the black-op range (r = pop/popEst; popFrom range), else carried from its anchor or a typical city (popFrom anchor | median, bbplan.unreadPopOf), null with nothing to go on.
      cities: cities.map((c) => ({ name: c.name, popEst: Math.round(c.popEst), pop: c.pop === null ? null : Math.round(c.pop), r: c.r === null ? null : +c.r.toFixed(5), popFrom: c.popFrom ?? null, anchor: anchors[c.name] ? { pop: Math.round(anchors[c.name].pop), comms: anchors[c.name].comms } : null, chaos: +c.chaos.toFixed(2), comms: c.comms })),
      // Read this pass: dated now, never the carried date of an older read (bbplan.divisionCarryOf).
      citiesAt: new Date(now).toISOString(),
      staminaBonus: +staminaBonusOf(person, v.sm, maxStamina).toFixed(4),
      outcomes: { n: rn, observed, expected, last: recent.slice(-5), method: 'attempts from the count against its growth twin, successes from the rank (bbplan.attemptsOf)', unmeasured },
      calibration: { ...calib, success: { ...sCal, groups: calGroups } },
      purchases: purchases.slice(-5),
      // The skill clock the exit model runs on (bbplan.bladeStartOf skillSinceS): this process's last spend, null before its first.
      skillsAt: lastSkills > 0 ? new Date(lastSkills).toISOString() : null,
      samples: samples.slice(-61).map((s) => ({ at: new Date(s.t).toISOString(), rank: s.rank, stamina: s.stamina })),
      detail: exitReady ? 'exit ready — waiting on endgame.js' : slot.ours ? pick.why : `not acting: ${slot.why}`,
    })
    // Every later record (waiting, refused, stopped) carries this read (bbplan.divisionCarryOf).
    carry.rec = divisionCarryOf(full, info.currentNode)

    // ---- 6. sleep to the end of the attempt (or a short poll) -------------
    let wait = 10e3
    if (slot.ours && current && d) {
      const left = bb.getActionTime(current.type, current.name) - bb.getActionCurrentTime()
      wait = Math.max(200, Math.min(30e3, left + 100))
    } else if (exitReady) wait = 60e3
    await ns.sleep(wait)
  }
}
