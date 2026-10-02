// bb-lite.js — the Bladeburner division from the minute it is joinable, on a
// lean RAM surface, until a host holds bladeburner.js.
//
// THE PROBLEM. bladeburner.js needs 92.75GB in one block (25 ns.bladeburner
// functions at 4GB each, not scaled by Source-File 4). Live BN6 (2026-10-01)
// the division was joined ~5h after combat 100 waiting for that block; live
// BN4 (2026-10-02) at a 64GB home the largest rooted host was 32GB and full.
//
// THE SHAPE. This coordinator references NO ns.bladeburner function but the
// free inBladeburner. The game work is done by one-shot actors, each a few
// 4GB calls (bbliteplan.ACTOR), run one at a time on whichever rooted host
// has the room — the shape act.js uses for Singularity — and they answer on
// a port (0GB). A Bladeburner action needs no resident script: the game
// repeats it by itself (Bladeburner.processAction :1313); this re-decides
// once per action (bbplan.actionTime), at most once a minute.
//
//   bb-lite-join.js   9.6GB  join the division at combat 100, the faction at rank 25
//   bb-lite-read.js  13.6GB  ranges, counts, max levels, the next black op
//   bb-lite-act.js   14.6GB  stamina, rank, the running action; decide; start (on a claim read in it)
//   bb-lite-skill.js 13.6GB  skill points, hourly (POLICY.skillEveryS), bbplan.planSkills
//   bb-lite-level.js 13.6GB  once per process: autolevel back on (bladeburner.js turns it off)
//
// Every decision is bbplan.js's (chooseAction, planSkills) under LITE_POLICY
// on bbliteplan.leanViewOf — the lean surface's limits are named there.
//
// THE SLOT. Acts only on a claim (bbslot.slotClaim): progress.js's
// slot.owner 'bladeburner', else — before the planner can run at all —
// act.js's bootstrap claim (actplan 0b). The claim is re-read in the act
// actor immediately before startAction.
//
// THE HANDOVER. When bladeburner.js is in its loop it publishes
// /tel/bladeburner.txt with daemon 'bladeburner.js' (result 'handover-wait':
// it does not act while this is alive, bbliteplan.liteAliveOf). This sees
// that (bbliteplan.fullTakingOverOf), publishes 'handed-over' and exits; the
// watchdog also stops it once bladeburner.js runs. One actor at every
// moment, and the game repeats the last action through the gap.
//
// PUBLISHES /tel/bb-lite.txt (its own heartbeat, every pass) and, while it
// is the actor, /tel/bladeburner.txt in bladeburner.js's shape with daemon
// 'bb-lite' (bbliteplan.liteRecordOf) — the plan, sleeve.js and the health
// checks read one file whichever daemon runs.
//
// RAM: base 1.6 + getResetInfo 1 + getPlayer 0.5 + exec 1.3 + scp 0.6 +
// scan 0.2 + getScriptRam 0.1 + isRunning 0.1 + hasRootAccess 0.05 +
// getServerMaxRam 0.05 + getServerUsedRam 0.05 + getHostname 0.05 (+ the
// ports, read, write, sleep, atExit: 0). Asserted by tools/test/bblite.test.mjs.

import { canJoinBladeburner } from 'sfgate.js'
import { reporter, describe, record } from 'status.js'
import { bitNodeMults } from 'bitNodeMultipliers.js'
import { slotClaim, SLOT_FILES } from 'bbslot.js'
import { hacknetLast, isHacknetServerHost } from 'hacknetplan.js'
import { POLICY, BBC } from 'bbplan.js'
import { LITE_FILE, BB_FILE, LITE_PORT, ACTOR, LITE_ACTOR_GB, reserveHostOf, fullTakingOverOf, joinableOf, liteRecordOf, passWaitMs, rankPerHourOf, leanViewOf } from 'bbliteplan.js'

const ACTOR_WAIT_MS = 15e3

export async function main(ns) {
  ns.disableLog('ALL')
  const info = ns.getResetInfo()
  const host = ns.getHostname()
  const errors = []
  const base = { bitNode: info.currentNode, lastAugReset: info.lastAugReset, host, daemon: 'bb-lite' }
  const note = reporter(ns, LITE_FILE, () => ({ ...base, errors: errors.slice(-5) }))
  const mirror = (files) => {
    try {
      if (host !== 'home') ns.scp(files, 'home', host)
    } catch {
      /* home unreachable; the local copy still stands */
    }
  }
  const say = (health, fields) => {
    const body = note(health, fields)
    mirror([LITE_FILE])
    return body
  }
  // The full daemon's record and this one's share a file; this one writes it
  // only while it is the actor (not after it has seen bladeburner.js).
  let ownsRecord = true
  const sayBB = (rec) => {
    if (!ownsRecord) return
    ns.write(BB_FILE, JSON.stringify({ at: new Date().toISOString(), health: rec.health ?? 'ok', ...rec }), 'w')
    mirror([BB_FILE])
  }
  ns.atExit(() => {
    note.exit('stopped', { detail: 'bb-lite.js exited' })
    mirror([LITE_FILE])
  })

  if (!canJoinBladeburner(info)) {
    say('waiting', { result: 'capability-absent', detail: 'No Bladeburner in this node (NetscriptFunctions/Bladeburner.ts:331-342): BitNode 6/7 or Source-File 6/7 needed.' })
    return
  }
  const mults = bitNodeMults(info.currentNode)
  if (!mults || !(mults.BladeburnerRank > 0)) {
    say('waiting', { result: 'disabled-in-node', detail: `BladeburnerRank ${mults?.BladeburnerRank} in BitNode ${info.currentNode}` })
    return
  }
  try {
    await loop(ns, { info, host, mults, say, sayBB, setOwns: (v) => (ownsRecord = v) })
  } catch (err) {
    ns.print(record(errors, err))
    say('error', { result: 'error', detail: describe(err) })
    throw err
  }
}

/** Every rooted host, by BFS from home. */
function hostsOf(ns) {
  const seen = new Set(['home'])
  const queue = ['home']
  while (queue.length) for (const h of ns.scan(queue.shift())) if (!seen.has(h)) seen.add(h) && queue.push(h)
  return [...seen].filter((h) => ns.hasRootAccess(h))
}

/** A script and what it imports, read from home (0GB): what an actor off home needs beside it. */
function closureOf(ns, root) {
  const out = new Set([root])
  const queue = [root]
  while (queue.length) {
    const src = String(ns.read(queue.shift()) || '')
    for (const m of src.matchAll(/from\s+['"]([^'"]+\.js)['"]/g)) {
      const dep = m[1].replace(/^\//, '')
      if (!out.has(dep)) {
        out.add(dep)
        queue.push(dep)
      }
    }
  }
  return [...out]
}

/**
 * Run one actor where it fits (most free first, hacknet servers last — a GB
 * there costs its hashes) and return its answer from the port.
 * {ok, out} or {ok: false, why}.
 */
export async function runActor(ns, script, input, { withSlot = false, prefer = null } = {}) {
  const price = ns.getScriptRam(script, 'home')
  if (!(price > 0)) return { ok: false, why: `${script} does not price on home (missing, or it does not compile)` }
  // The reserved host first (batch.js leaves LITE_ACTOR_GB free there), then
  // home, then the rest by free RAM — hacknet servers last (a GB there costs
  // its hashes). Free RAM is read again at the exec, and a refusal moves on to
  // the next host rather than ending the pass.
  const freeOf = (h) => ns.getServerMaxRam(h) - ns.getServerUsedRam(h)
  const cands = hostsOf(ns)
    .map((h) => ({ h, free: freeOf(h) }))
    .filter((x) => x.free >= price)
    .sort((a, b) => (b.h === prefer) - (a.h === prefer) || (b.h === 'home') - (a.h === 'home') || hacknetLast(a.h, b.h) || b.free - a.free)
  if (!cands.length) return { ok: false, why: `no rooted host has ${price}GB free for ${script}${prefer ? ` (the reserved ${prefer} has ${freeOf(prefer).toFixed(2)}GB)` : ''}` }
  const refused = []
  for (const { h: target } of cands) {
    if (target !== 'home') {
      ns.scp(closureOf(ns, script), target, 'home')
      // The act actor reads the claim from its own host's copies: pulled now, a moment before it runs.
      if (withSlot) ns.scp(SLOT_FILES, target, 'home')
    }
    const free = freeOf(target)
    if (free < price) {
      refused.push(`${target} ${free.toFixed(2)}GB free`)
      continue
    }
    ns.clearPort(LITE_PORT)
    const pid = ns.exec(script, target, 1, JSON.stringify(input ?? {}))
    if (!pid) {
      refused.push(`${target} refused with ${free.toFixed(2)}GB free`)
      continue
    }
    const until = Date.now() + ACTOR_WAIT_MS
    while (ns.isRunning(pid) && Date.now() < until) await ns.sleep(20)
    const raw = ns.readPort(LITE_PORT)
    let out = null
    try {
      out = typeof raw === 'string' ? JSON.parse(raw) : null
    } catch {
      out = null
    }
    if (!out) return { ok: false, why: `${script} on ${target} answered nothing (pid ${pid}, ${ns.isRunning(pid) ? 'still running' : 'exited'})`, host: target }
    if (!out.ok) return { ok: false, why: `${script}: ${out.error ?? 'failed'}`, out, host: target }
    return { ok: true, out, host: target, refused }
  }
  return { ok: false, why: `exec of ${script} (${price}GB) refused on every candidate: ${refused.join('; ')}` }
}

async function loop(ns, { info, host, mults, say: say0, sayBB, setOwns }) {
  // Every record carries the reservation: batch.js reads it off /tel/bb-lite.txt.
  let reserveNow = null
  const say = (health, fields) => say0(health, { reserve: reserveNow, ...fields })
  const bnRank = mults.BladeburnerRank
  const costMult = mults.BladeburnerSkillCost
  let resting = false
  let levels = {}
  let skillPoints = null
  let lastSkills = 0
  let leveled = false
  let reads = null
  let rank = null
  let stamina = null
  let maxStamina = null
  let factionJoined = null
  let blackFrom = 0
  let reserveHost = null
  const samples = []
  const purchases = []
  const actorErrors = []
  const fail = (why) => {
    actorErrors.push({ at: new Date().toISOString(), why })
    while (actorErrors.length > 5) actorErrors.shift()
  }

  for (;;) {
    // ---- 0. the handover ---------------------------------------------------
    mirrorFrom(ns, host, BB_FILE)
    const full = fullTakingOverOf(readJson(ns, BB_FILE), info, Date.now())
    if (full.over) {
      setOwns(false)
      say('ok', { result: 'handed-over', detail: `${full.why}: bb-lite stands down` })
      return
    }

    // ---- 0b. the reservation batch.js honours (bbliteplan.liteReserveOf) ----
    reserveHost = reserveHostOf(host, hostsOf(ns).map((h) => ({ host: h, max: ns.getServerMaxRam(h), hacknet: isHacknetServerHost(h) })), reserveHost)
    reserveNow = reserveHost ? { host: reserveHost, gb: LITE_ACTOR_GB } : null
    const act = (script, input, o = {}) => runActor(ns, script, input, { ...o, prefer: reserveHost })

    // ---- 1. the division ---------------------------------------------------
    const player = ns.getPlayer()
    const person = { skills: { ...player.skills }, mults: { ...player.mults } }
    const j = joinableOf(player.skills)
    if (!ns.bladeburner.inBladeburner()) {
      if (!j.ok) {
        const fields = { result: 'not-joined', joined: false, combat: j.combat, need: 100, detail: `the division needs every combat stat >= 100 (NetscriptFunctions/Bladeburner.ts:347-352); lowest is ${j.low} — the body leg trains it (progress.js bladeGymStep, actplan 0b)` }
        say('waiting', fields)
        sayBB({ ...liteRecordOf({ info, host, result: 'not-joined', joined: false, detail: fields.detail }), health: 'waiting', combat: j.combat })
        await ns.sleep(60e3)
        continue
      }
      const r = await act(ACTOR.join, { faction: false })
      if (!r.ok || !r.out.joined) {
        const why = r.ok ? `joinBladeburnerDivision returned ${r.out.divisionCall} with combat ${j.low}+ and the division still refuses (the reason is in bb-lite-join.js's log)` : r.why
        fail(why)
        say(r.ok ? 'error' : 'waiting', { result: r.ok ? 'join-refused' : 'actor-unplaced', joined: false, detail: why, actorErrors })
        await ns.sleep(30e3)
        continue
      }
    }

    // ---- 2. once per process: autolevel back on ------------------------------
    if (!leveled) {
      const r = await act(ACTOR.level, {})
      if (r.ok) leveled = true
      else fail(r.why)
    }

    // ---- 3. the faction at rank 25 --------------------------------------------
    factionJoined = (player.factions ?? []).includes('Bladeburners')
    if (!factionJoined && rank !== null && rank >= BBC.RankNeededForFaction) {
      const r = await act(ACTOR.join, { faction: true })
      if (r.ok) factionJoined = r.out.factionCall === true
      else fail(r.why)
    }

    // ---- 4. the reads -------------------------------------------------------
    {
      const r = await act(ACTOR.read, { from: blackFrom })
      if (r.ok) {
        reads = { actions: r.out.actions, blackOp: r.out.blackOp, done: r.out.done }
        blackFrom = r.out.done
      } else fail(r.why)
    }
    if (!reads) {
      say('waiting', { result: 'actor-unplaced', joined: true, detail: `no reads yet: ${actorErrors[actorErrors.length - 1]?.why ?? '?'}`, actorErrors })
      await ns.sleep(15e3)
      continue
    }

    // ---- 5. skills, hourly ----------------------------------------------------
    if (Date.now() - lastSkills > POLICY.skillEveryS * 1000 && stamina !== null) {
      const r = await act(ACTOR.skill, { person, reads, stamina, maxStamina, rank, bnRank, costMult })
      if (r.ok) {
        levels = r.out.levels
        skillPoints = r.out.skillPoints
        for (const p of r.out.purchases) purchases.push({ at: new Date().toISOString(), ...p })
        while (purchases.length > 20) purchases.shift()
        lastSkills = Date.now()
      } else fail(r.why)
    }

    // ---- 6. decide and act (the claim is re-read in the actor) ------------------
    mirrorFrom(ns, host, ...SLOT_FILES)
    const claimHere = slotClaim(ns, host, info) // for the record; the actor's own read decides
    const r = await act(ACTOR.act, { person, reads, levels, bnRank, resting, lastAugReset: info.lastAugReset }, { withSlot: true })
    let pick = null
    let current = null
    let slot = claimHere
    let started = null
    if (r.ok) {
      ;({ stamina, maxStamina, rank, resting, pick, current, slot, started } = r.out)
    } else fail(r.why)

    // ---- 7. publish -------------------------------------------------------------
    const now = Date.now()
    if (rank !== null && (!samples.length || now - samples[samples.length - 1].t >= 60e3)) {
      samples.push({ t: now, rank, stamina })
      while (samples.length > 61) samples.shift()
    }
    const ours = slot?.ours === true
    const result = !r.ok ? 'actor-unplaced' : ours ? (started === true ? 'started' : 'acting') : 'slot-not-ours'
    const detail = !r.ok ? r.why : ours ? pick?.why ?? '' : `not acting: ${slot?.why ?? '?'}`
    say(r.ok ? (ours ? 'ok' : 'waiting') : 'waiting', { result, joined: true, factionJoined, rank, stamina, maxStamina, resting, slot, action: pick, running: current, skillPoints, levels, purchases: purchases.slice(-5), actorErrors, detail })
    sayBB({
      ...liteRecordOf({
        info, host, result, joined: true, factionJoined, rank, rankPerHour: rankPerHourOf(samples, now), skillPoints, levels, stamina, maxStamina, resting, slot, pick, running: current, reads,
        skillsAt: lastSkills > 0 ? new Date(lastSkills).toISOString() : null,
        samples: samples.map((s) => ({ at: new Date(s.t).toISOString(), rank: +s.rank.toFixed(2), stamina: s.stamina === null ? null : +s.stamina.toFixed(2) })),
        detail,
      }),
      health: r.ok ? (ours ? 'ok' : 'waiting') : 'waiting',
    })

    // ---- 8. until the action ends (or a minute) ------------------------------------
    const view = r.ok ? leanViewOf({ person, reads, levels, stamina, maxStamina, rank, bnRank, resting }) : null
    await ns.sleep(r.ok && ours ? passWaitMs(pick, view) : 30e3)
  }
}

function readJson(ns, f) {
  try {
    return JSON.parse(ns.read(f) || 'null')
  } catch {
    return null
  }
}

/** ns.read is local: pull home's copies first when placed elsewhere. */
function mirrorFrom(ns, host, ...files) {
  try {
    if (host !== 'home') ns.scp(files, host, 'home')
  } catch {
    /* the copy here, if any */
  }
}
