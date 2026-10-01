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
import { reporter, describe, record } from 'status.js'
import { raiseRam } from 'ramgrow.js'
import { bitNodeMults } from 'bitNodeMultipliers.js'
import { BBC, TYPE, GENERAL, LEVELED, CONTRACTS, OPERATIONS, BLACK_OPS, SKILLS, POLICY, JOIN_COMBAT, DAEDALUS, CITY_NAMES, dataOf, typeOf, skillMultsOf, envFromChance, chooseAction, planSkills, actionTime, maxStaminaOf, staminaGainOf, pFrom, bestCity } from 'bbplan.js'

const STATUS = '/tel/bladeburner.txt'
const PROGRESS = '/tel/progress.txt'
const ORDERS = '/tel/orders.txt'
/** Orders that put the player's work slot on something else (act.js actors that start work). */
const WORK_ORDERS = new Set(['gym', 'crime', 'work', 'graft', 'company', 'course', 'focus'])
/** progress.js is a job that publishes every pass; a claim older than this is no claim (actplan.js PROGRESS_FRESH_MS). */
const SLOT_FRESH_MS = 15 * 60e3
/** Full static price, measured by the game's calculator ([R5]); no ns.singularity, so no `* mult` term. */
const RAISE_CEILING = (mult) => 92.75 + 0 * mult

export async function main(ns) {
  ns.ramOverride(3.25)

  const rerrors = []
  const note = reporter(ns, STATUS, () => ({ errors: rerrors.slice(-5) }))
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

  if (!(await raiseRam(ns, RAISE_CEILING(1), STATUS, 'bladeburner.js needs its full allocation before the first ns.bladeburner call'))) {
    mirror()
    return
  }

  try {
    await operate(ns, say, info, mults)
  } catch (err) {
    ns.print(record(rerrors, err))
    say('error', { result: 'error', bitNode: info.currentNode, lastAugReset: info.lastAugReset, detail: describe(err) })
    throw err
  }
}

/**
 * progress.js's claim on the work slot, read from home (ns.read is local to this host).
 *
 * A HANDOFF IS NOT A CLAIM. startAction calls Player.finishWork BEFORE it
 * checks anything (Bladeburner.ts:179-186), so starting on a claim the
 * planner has already moved on from kills the work it moved to. An order
 * batch written after the claim that starts work (gym, crime, faction work,
 * a graft...) means the slot is being handed to it — progress.js passes that
 * flush orders without rewriting /tel/progress.txt (the Covenant batch path)
 * leave the older claim standing beside them — so the claim does not hold
 * until a newer progress.txt says it does.
 */
export function slotClaim(ns, host, info) {
  try {
    if (host !== 'home') {
      ns.scp(PROGRESS, host, 'home')
      ns.scp(ORDERS, host, 'home')
    }
  } catch {
    /* fall through to whatever copy is here; its age decides */
  }
  let pr = null
  try {
    pr = JSON.parse(ns.read(PROGRESS) || 'null')
  } catch {
    pr = null
  }
  const at = Date.parse(pr?.at ?? '')
  if (!Number.isFinite(at)) return { owner: null, ours: false, why: '/tel/progress.txt is absent or unreadable — no claim' }
  if (at < info.lastAugReset) return { owner: null, ours: false, why: `/tel/progress.txt (${pr.at}) predates this life — no claim` }
  if (Date.now() - at > SLOT_FRESH_MS) return { owner: null, ours: false, why: `/tel/progress.txt is ${((Date.now() - at) / 60e3).toFixed(0)} min old — no claim` }
  const owner = pr?.slot?.owner ?? null
  if (owner === 'bladeburner') {
    let ob = null
    try {
      ob = JSON.parse(ns.read(ORDERS) || 'null')
    } catch {
      ob = null
    }
    const oAt = Date.parse(ob?.at ?? '')
    const work = Number.isFinite(oAt) && oAt > at && ob?.lastAugReset === info.lastAugReset && Array.isArray(ob.orders) ? ob.orders.find((o) => WORK_ORDERS.has(o?.kind)) : null
    if (work) return { owner: `handoff:${work.kind}`, ours: false, at: pr.at, why: `an order batch (${ob.at}) newer than the claim (${pr.at}) starts ${work.kind} — the slot is being handed off; not starting an action until progress.js claims it again` }
  }
  return { owner, ours: owner === 'bladeburner', at: pr.at, why: owner === 'bladeburner' ? 'progress.js holds the slot for bladeburner' : `progress.js holds the slot for ${owner ?? 'nobody'}` }
}

async function operate(ns, say, info, mults) {
  const bb = ns.bladeburner
  const host = ns.getHostname()
  const flags = ns.flags([
    ['own-slot', false], // testing only: act without progress.js's claim
  ])
  const bnRank = mults.BladeburnerRank
  const costMult = mults.BladeburnerSkillCost
  const base = { bitNode: info.currentNode, lastAugReset: info.lastAugReset, host }

  let resting = false
  let city = null
  let lastSkills = 0
  const autoOff = new Set()
  const samples = [] // {t, rank, stamina, maxStamina} once a minute, the last hour
  const outcomes = [] // {name, level, p, ok} the last 30 completions
  let pending = null // the attempt in flight: {type, name, level, p, rank0, gain, startedAt}
  let teamSet = -1
  const purchases = []

  for (;;) {
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
    const cities = CITY_NAMES.map((name) => ({ name, pop: bb.getCityEstimatedPopulation(name), chaos: bb.getCityChaos(name), comms: bb.getCityCommunities(name) }))
    if (!city) city = bestCity(cities).name
    bb.switchCity(city) // where the probes are read; getCity is not paid for, so the daemon always sets it
    const team = bb.getTeamSize()
    if (team !== teamSet) {
      // Operations and black ops take the whole team (supporting sleeves count, Bladeburner.ts:101-103).
      for (const d of [...Object.values(OPERATIONS), ...BLACK_OPS]) bb.setTeamSize(typeOf(d), d.name, team)
      teamSet = team
    }

    // A completed attempt: compare the rank it moved with what success would have paid.
    if (pending) {
      const cur = bb.getCurrentAction()
      const done = !cur || cur.name !== pending.name || bb.getActionCurrentTime() < pending.elapsedMs
      if (done) {
        const dr = rank - pending.rank0
        outcomes.push({ name: pending.name, level: pending.level, p: pending.p, ok: dr >= 0.5 * pending.gain })
        if (outcomes.length > 30) outcomes.shift()
        pending = null
      }
    }

    const readEnv = () => {
      const sm = skillMultsOf(levels)
      const ref = cities.find((c) => c.name === city)
      let Kc = 0
      let Ko = 0
      let width = 0
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
        width = Math.max(width, hi - lo)
        if (!(d.name === 'Raid' && ref.comms < 1)) {
          const K = envFromChance(lo, d, maxLevel, person, sm)
          if (d.kind === 'contract') Kc = Math.max(Kc, K)
          else Ko = Math.max(Ko, K)
        }
        actions.push({ d, count, maxLevel, width: hi - lo })
      }
      for (const a of actions) a.K = a.d.kind === 'contract' ? Kc : Ko
      const next = bb.getNextBlackOp()
      let blackOp = null
      if (next) {
        const d = dataOf(next.name)
        const [lo, hi] = bb.getActionEstimatedSuccessChance(TYPE.blackOp, next.name)
        blackOp = { d, K: envFromChance(lo, d, 1, person, sm), width: hi - lo, lo, hi }
      }
      return {
        person, sm, levels, bnRank, rank, stamina, maxStamina,
        staminaGain: staminaGainOf(person, sm, maxStamina), maxStaminaBase: false,
        resting, ref: { pop: ref.pop, chaos: ref.chaos }, cities, city, actions, blackOp,
        K: { contracts: Kc, operations: Ko },
      }
    }

    // ---- 3. skills: no slot needed ----------------------------------------
    let sp = bb.getSkillPoints()
    if (sp >= 1 && Date.now() - lastSkills > 60e3) {
      const v = readEnv()
      for (const b of planSkills(v, sp, POLICY, costMult)) {
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
        if (!pending) pending = { type: pick.type, name: pick.name, level, p: pick.p, rank0: rank, gain: d.kind === 'blackop' ? d.rankGain * bnRank : d.rankGain * Math.pow(d.rewardFac, level - 1) * bnRank, elapsedMs: 0 }
      }
    } else if (!slot.ours) {
      pending = null
      // Not ours: nothing of ours may run. (The probes above moved every
      // action's level, so a leftover action would also be at the wrong one.)
      if (current) {
        bb.stopBladeburnerAction()
        current = bb.getCurrentAction()
      }
    }
    if (pending) pending.elapsedMs = bb.getActionCurrentTime()

    // ---- 5. publish --------------------------------------------------------
    const now = Date.now()
    if (!samples.length || now - samples[samples.length - 1].t >= 60e3) {
      samples.push({ t: now, rank: +rank.toFixed(2), stamina: +stamina.toFixed(2), maxStamina: +maxStamina.toFixed(2) })
      while (samples.length > 61) samples.shift()
    }
    const hourAgo = samples.find((s) => now - s.t <= 3600e3) ?? samples[0]
    const rankPerHour = samples.length > 1 && now > hourAgo.t ? ((rank - hourAgo.rank) / (now - hourAgo.t)) * 3600e3 : null
    const recent = outcomes.slice(-20)
    const observed = recent.length ? recent.filter((o) => o.ok).length / recent.length : null
    const expected = recent.length ? recent.reduce((s, o) => s + (o.p ?? 0), 0) / recent.length : null
    const bo = v.blackOp
    say(exitReady ? 'ok' : slot.ours ? 'ok' : 'waiting', {
      ...base,
      result: exitReady ? 'exit-ready' : slot.ours ? (started === null ? 'acting' : 'started') : 'slot-not-ours',
      joined: true,
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
      },
      exitReady,
      exitNote: exitReady ? `all 21 black ops complete (${DAEDALUS} done): destroyW0r1dD43m0n now accepts with no hacking level (Singularity.ts:1154-1158). endgame.js does it under its --next and /endgame-hold.txt; this script never will.` : null,
      env: { contracts: v.K.contracts, operations: v.K.operations },
      counts: Object.fromEntries(v.actions.map((a) => [a.d.name, +a.count.toFixed(1)])),
      maxLevels: Object.fromEntries(v.actions.map((a) => [a.d.name, a.maxLevel])),
      cities: cities.map((c) => ({ name: c.name, popEst: Math.round(c.pop), chaos: +c.chaos.toFixed(2), comms: c.comms })),
      outcomes: { n: recent.length, observed, expected, last: recent.slice(-5) },
      calibration: calib,
      purchases: purchases.slice(-5),
      samples: samples.slice(-61).map((s) => ({ at: new Date(s.t).toISOString(), rank: s.rank, stamina: s.stamina })),
      detail: exitReady ? 'exit ready — waiting on endgame.js' : slot.ours ? pick.why : `not acting: ${slot.why}`,
    })

    // ---- 6. sleep to the end of the attempt (or a short poll) -------------
    let wait = 10e3
    if (slot.ours && current && d) {
      const left = bb.getActionTime(current.type, current.name) - bb.getActionCurrentTime()
      wait = Math.max(200, Math.min(30e3, left + 100))
    } else if (exitReady) wait = 60e3
    await ns.sleep(wait)
  }
}
