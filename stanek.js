// STANEK'S GIFT, IN THE GAME: accept it at the node's start, place the
// layout, keep the charger running. A watchdog JOB on home (every 5 min where
// the Church is reachable: BN13, or SF13 held), one pass, then exit.
//
// THE ACCEPT IS PER NODE, AT ITS START: canAcceptStaneksGift (CotMG/Helper.tsx)
// needs no augmentation but NeuroFlux installed OR QUEUED, so the first non-NFG
// purchase blocks it and the first such install forfeits it for the node.
// act.js refuses every buyaug / graft / install order that would do that while
// the gift is not accepted (stanekplan.giftOrderGate), so the order here is
// guaranteed whatever runs first; this script is what makes the accept happen.
// Where the stack does not accept (stanekplan.GIFT_NODES) it publishes why.
//
// RAM IS ISOLATED HERE (CLAUDE.md "gate optional APIs and isolate their RAM"):
// the ns.stanek surface lives in this script (acceptGift 2, giftWidth/Height
// 0.8, activeFragments 5, placeFragment 5, clearGift 0) and in charge.js
// (chargeFragment 0.4, 2.0GB/thread) — nothing resident pays for it, and the
// watchdog's trigger is canAccessFeature(13) on the getResetInfo it already pays.
// The rest of the API throws until Genesis is installed (Stanek.ts:18), so the
// accept comes first and every other call is behind it.
//
// THE LAYOUT, PER LIFE (stanekplan.lifeTargetOf): an install zeroes the charge and
// keeps the layout, so each life may carry its own. progress.js decides this life's
// on the live exit model (decisions.stanek.layout: weights = the exit's marginal hours
// per unit ln of each fragment type; options priced as trajectories); placed while the
// life is young (LIFE_LAYOUT_WINDOW_MIN), else the incumbent kept; the tabled layout
// (stanekplan.layoutForGrid) on an empty grid and on the Bladeburner route. Placed only
// when the active set differs, verified by re-reading; /tel/stanek.txt lifeLayout is
// the decision record (STANEK LAYOUT STALE when the placed one is not it).
//
// THE PHASE PLAN WITHIN A LIFE (L2, stanekplan.phaseStepOf): the Bladeburner route's (progress.js
// publishes decisions.stanek.phase from BLADE_PHASE_PRICED; the condition, a black-op count, read off
// /tel/bladeburner.txt) or a hacking life's (the plan's layout.phase, at a life-hour). The early layout
// until the condition, then the late one — only from the early layout the switch was priced on. Every
// re-lay is a DIFF (stanekplan.relayDiffOf + removeFragment, 0.15GB): the game deletes a fragment with
// its charge (StaneksGift.delete), so unchanged fragments keep theirs; clearGift only if the diff fails.
// Health STANEK PHASE SWITCH LATE when a priced switch came due 15 min ago and has not landed.
//
// THE EPOCH DECISION (L3, stanekepoch.js): where progress.js has a fresh keep-vs-switch decision on the
// live state (/tel/stanekepoch.txt), it supersedes the phase plan: 'switch' re-lays (by diff) only from
// the layout it was priced from, 'keep' holds the placed one. Health STANEK EPOCH STALE / SWITCH NOT LANDED.
//
// THE CHARGER: charge.js on ANY rooted host — chargeFragment charges from whatever
// server the script runs on, at its threads x that server's core bonus (Stanek.ts;
// the gift is global), so home has no claim beyond its cores (and BN13.1 opened on a
// 128GB 1-core home already full: 0 charge for the node's first half hour). Its
// budget is f x the FLEET's RAM (f = the plan's decision of this life, /tel/plan.txt
// decisions.stanek basis 'fleet' — priced by the exit in progress.js; DEFAULT_F,
// labelled UNPRICED, until one exists), placed by stanekplan.chargerPlanOf: the host
// with the most power first (highestCharge is ONE script's power, so it concentrates),
// within the room once the batcher's h/g/w finish; launched now within what is free,
// and batch.js holds the rest per host (stanekHoldsOf). Relaunched per host when the
// roots or the count change by more than 10%. Every charge.js heartbeat
// (/tel/charge-<host>.txt, local to its host) is copied home into /tel/charge.txt, and
// the gift's own charge mass is compared with the last pass (FRAGMENTS NOT CHARGING
// names the binding cause: no room / waiting on the batcher / exec refused / flat).
//
// RAM: the fleet walk adds scan, hasRootAccess, scp, getScriptRam to the
// accept/place surface — this is a transient 5-min job, never resident.
//
// Publishes /tel/stanek.txt on every exit path (atExit): gift state, accept
// outcome, layout, fragments with their charge, charger, allocation, health.
import { giftStateOf, lifeTargetOf, planLayoutOf, planPhaseOf, bladePhaseStateOf, relayDiffOf, layoutKeyOf, sameLayout, chargeRootsOf, planAllocOf, DEFAULT_F, chargerFleetOf, chargerPlanOf, chargerActionsOf, chargerWhyOf, chargeProgressOf, coreBonus, progressBlockGb, STANEK_FILE, CHARGE_FILE, STANEK, TYPE, TYPE_NAME, routeOfProgress, giftVerdictOfProgress, PROGRESS_FILE, bladeChargeFOf, BLADE_F_MAX } from 'stanekplan.js'
import { epochTargetOf, EPOCH_FILE } from 'stanekepoch.js'
import { reservesOf, heldOn, FREEABLE } from 'raiseplace.js'
import { singularityRamMultiplier, canAccessCotMG } from 'sfgate.js'
import { bitNodeMults } from 'bitNodeMultipliers.js'

const CHARGER = 'charge.js'

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog('ALL')
  let info = ns.getResetInfo()
  const rec = { at: null, lastAugReset: info.lastAugReset, lastNodeReset: info.lastNodeReset ?? null, node: info.currentNode, health: 'error', phase: 'start', why: null }
  let published = false
  const publish = (extra = {}) => {
    Object.assign(rec, extra)
    rec.at = new Date().toISOString()
    ns.write(STANEK_FILE, JSON.stringify(rec, null, 1), 'w')
    published = true
  }
  ns.atExit(() => {
    if (!published) publish({ health: 'error', why: rec.why ?? `stanek.js exited before publishing (phase ${rec.phase})` })
  })
  try {
    // the route this node plays (progress.js's record of this node and life): outside BN13 the gift is
    // wanted only on the Bladeburner route where its priced exit wins (stanekplan.giftWantOf)
    const progText = ns.read(PROGRESS_FILE)
    const route = routeOfProgress(progText, info)
    // the route decision's gift verdict (L4 chain: blade+gift / blade / hack priced as one decision)
    const verdict = giftVerdictOfProgress(progText, info)
    let gift = giftStateOf(info, canAccessCotMG(info), route, verdict)
    rec.gift = gift
    if (!gift.available) return publish({ health: 'n/a', why: gift.why })
    // ---- 1. THE ACCEPT ---------------------------------------------------
    if (!gift.accepted && gift.want && !gift.forfeited) {
      rec.phase = 'accept'
      const returned = ns.stanek.acceptGift()
      info = ns.getResetInfo() // read back from the game, not from the call's return
      gift = giftStateOf(info, canAccessCotMG(info), route, verdict)
      rec.gift = gift
      rec.accept = { at: new Date().toISOString(), returned, accepted: gift.accepted }
      if (!gift.accepted) {
        rec.refused = `acceptGift returned ${returned} and Stanek's Gift - Genesis is not installed: ${gift.forfeited ? gift.why : 'a QUEUED non-NeuroFlux augmentation blocks it (canAcceptStaneksGift reads installed + queued) — an install would forfeit the gift; a soft reset clears the queue'}`
      }
    }
    if (!gift.accepted) return publish({ health: gift.want ? 'fail' : 'ok', why: rec.refused ?? gift.why })
    // ---- 2. THE LAYOUT ---------------------------------------------------
    rec.phase = 'layout'
    const width = ns.stanek.giftWidth()
    const height = ns.stanek.giftHeight()
    const nodePower = bitNodeMults(info)?.StaneksGiftPowerMultiplier
    if (typeof nodePower !== 'number' || !isFinite(nodePower)) return publish({ health: 'fail', why: `StaneksGiftPowerMultiplier unknown for BitNode ${info.currentNode} (bitNodeMultipliers.js) — no layout chosen` })
    const prevRec = (() => {
      try {
        return JSON.parse(ns.read(STANEK_FILE) || 'null')
      } catch {
        return null
      }
    })()
    // THE LIFE'S LAYOUT (stanekplan.lifeTargetOf): the plan's decision of this life (progress.js, the
    // live exit model, decided while the install's zero charge makes a re-lay free), else the
    // incumbent an install kept, else the tabled one; the Bladeburner route keeps its tabled layout.
    let active = ns.stanek.activeFragments()
    const planText = ns.read('/tel/plan.txt')
    const planLayout = gift.basis === 'blade' ? null : planLayoutOf(planText, info.lastAugReset, width, height)
    // THE PHASE PLAN (L2, stanekplan.phaseStepOf): the Bladeburner route's (progress.js publishes it from
    // BLADE_PHASE_PRICED; its condition read off /tel/bladeburner.txt) or the hacking life's (planLayout.phase)
    const phase = gift.basis === 'blade' ? planPhaseOf(planText, info.lastAugReset, width, height) : null
    const phaseState = gift.basis === 'blade' ? bladePhaseStateOf(ns.read('/tel/bladeburner.txt'), info) : null
    // THE EPOCH DECISION (L3, stanekepoch.epochTargetOf): progress.js's keep-vs-switch on the live state,
    // fresh, this node and life; a switch re-lays only from the layout it was priced from
    const epoch = gift.basis === 'blade' ? epochTargetOf(ns.read(EPOCH_FILE), info, active, width, height) : null
    const target = lifeTargetOf({ basis: gift.basis, width, height, nodePower, active, plan: planLayout, prev: prevRec, lastAugReset: info.lastAugReset, lastNodeReset: info.lastNodeReset ?? null, phase, phaseState, epoch })
    rec.lifeLayout = target.record
    let placeFails = []
    if (!sameLayout(active, target.placed)) {
      // THE RE-LAY AS A DIFF (stanekplan.relayDiffOf): the game deletes a fragment with its charge
      // (StaneksGift.delete), so only the removed/changed ones go; unchanged fragments keep their charge.
      const diff = relayDiffOf(active, target.placed)
      const removeFails = diff.remove.filter((p) => !ns.stanek.removeFragment(p.x, p.y))
      for (const p of diff.place) if (!ns.stanek.placeFragment(p.x, p.y, p.rot, p.id)) placeFails.push(p)
      let cleared = false
      if (removeFails.length || placeFails.length) {
        // the diff did not land (a legal target always places on an empty grid): clear and place all
        ns.stanek.clearGift()
        cleared = true
        placeFails = []
        for (const p of target.placed) if (!ns.stanek.placeFragment(p.x, p.y, p.rot, p.id)) placeFails.push(p)
      }
      active = ns.stanek.activeFragments()
      rec.placedAt = new Date().toISOString()
      rec.lifeLayout.relaid = rec.placedAt
      rec.lifeLayout.relay = { kept: diff.keep.length, removed: diff.remove.length, placed: diff.place.length, removeFails: removeFails.length, cleared }
    }
    const placedOk = sameLayout(active, target.placed)
    const activePlaced = active.map((f) => ({ id: f.id, x: f.x, y: f.y, rot: f.rotation }))
    rec.layout = { width, height, nodePower, key: `${width}x${height}|${nodePower}`, decidedKey: target.record.key, placedKey: layoutKeyOf(activePlaced), source: target.record.source, placed: target.placed, ok: placedOk, placeFails }
    rec.fragments = active.map((f) => ({ id: f.id, x: f.x, y: f.y, rot: f.rotation, type: TYPE_NAME[f.type] ?? f.type, highestCharge: f.highestCharge, numCharge: f.numCharge, effect: f.chargedEffect }))
    // ---- 3. THE CHARGER --------------------------------------------------
    rec.phase = 'charger'
    rec.progress = chargeProgressOf(prevRec, rec.fragments, info.lastAugReset)
    // What is actually placed is what can be charged (a failed placement is published, not charged).
    const roots = chargeRootsOf(active.filter((f) => f.type !== TYPE.Booster).map((f) => ({ id: f.id, x: f.x, y: f.y, rot: f.rotation })))
    const plan = gift.basis === 'blade' ? null : planAllocOf(ns.read('/tel/plan.txt'), info.lastAugReset)
    let f = plan ? plan.f : DEFAULT_F
    rec.alloc = { f, basis: 'fraction of the fleet RAM', source: plan ? `the plan (${plan.at}, decisions.stanek)` : `DEFAULT_F ${DEFAULT_F} (UNPRICED): no priced fleet-basis decision of this life in /tel/plan.txt decisions.stanek`, why: plan?.why ?? null }
    // THE FLEET: every rooted host (chargeFragment charges from any server, at its cores).
    const seen = new Set(['home'])
    const queue = ['home']
    while (queue.length) for (const n of ns.scan(queue.shift())) if (!seen.has(n)) seen.add(n), queue.push(n)
    const names = [...seen].filter((h) => !/^hacknet-(server|node)-\d+$/.test(h) && ns.hasRootAccess(h))
    const raised = reservesOf((p) => ns.read(p), info, names)
    const reserveGb = progressBlockGb(singularityRamMultiplier(info))
    const running = []
    const raw = []
    for (const host of names) {
      const maxRam = ns.getServerMaxRam(host)
      if (!(maxRam >= STANEK.ramPerThread)) continue
      let workerGb = 0
      let chargerGb = 0
      for (const p of ns.ps(host)) {
        if (p.filename === CHARGER) {
          running.push({ host, pid: p.pid, threads: p.threads, args: p.args })
          chargerGb += p.threads * STANEK.ramPerThread
        } else if (FREEABLE.includes(p.filename)) workerGb += p.threads * ns.getScriptRam(p.filename, host)
      }
      raw.push({ host, maxRam, used: ns.getServerUsedRam(host), cores: ns.getServer(host).cpuCores, workerGb, chargerGb, reserveGb: (host === 'home' ? reserveGb : 0) + heldOn(raised, host) })
    }
    const fleet = chargerFleetOf(raw)
    // THE BLADEBURNER ROUTE'S CHARGER (stanekplan.BLADE_HOST, the policy its exit was priced with):
    // the biggest rooted host's room, at most BLADE_F_MAX of the fleet
    if (gift.basis === 'blade') {
      f = bladeChargeFOf(fleet)
      rec.alloc = { f, basis: 'fraction of the fleet RAM', source: `the Bladeburner route's charger (stanekplan.bladeChargeFOf: the biggest host, <= ${BLADE_F_MAX} of the fleet)`, why: gift.wantWhy ?? null }
    }
    rec.fleet = { gb: fleet.reduce((s, h) => s + h.maxRam, 0), hosts: fleet.map((h) => ({ host: h.host, cores: h.cores, maxRam: h.maxRam, capGb: h.capGb, capNow: h.capNow })) }
    const cp = chargerPlanOf({ f: roots.length ? f : 0, fleet })
    const rootsArg = JSON.stringify(roots)
    const act = chargerActionsOf(cp, running, rootsArg, info.lastAugReset)
    for (const pid of act.stops) ns.kill(pid)
    const execFails = []
    const launched = [...act.keep]
    for (const e of act.starts) {
      if (e.host !== 'home' && !ns.scp(CHARGER, e.host, 'home')) {
        execFails.push({ ...e, why: 'scp failed' })
        continue
      }
      const pid = ns.exec(CHARGER, e.host, e.threads, rootsArg, info.lastAugReset, e.host)
      if (pid > 0) launched.push({ host: e.host, threads: e.threads, pid })
      else execFails.push({ ...e, why: 'ns.exec returned 0' })
    }
    // THE HEARTBEATS: each charge.js writes /tel/charge-<host>.txt on ITS host (ns.write is
    // local); copied home and gathered into /tel/charge.txt for the health check.
    const beats = {}
    for (const l of launched) {
      const file = `/tel/charge-${l.host}.txt`
      if (l.host !== 'home') ns.scp(file, 'home', l.host)
      try {
        beats[l.host] = JSON.parse(ns.read(file) || 'null')
      } catch {
        beats[l.host] = null
      }
    }
    ns.write(CHARGE_FILE, JSON.stringify({ at: new Date().toISOString(), lastAugReset: info.lastAugReset, hosts: beats }), 'w')
    const threads = launched.reduce((s, l) => s + l.threads, 0)
    const now = new Map(launched.map((l) => [l.host, l.threads]))
    const hosts = cp.hosts.map((h) => ({ ...h, now: now.get(h.host) ?? 0 }))
    const placed = { ...cp, threads, hosts }
    const why = chargerWhyOf({ roots: roots.length, f, plan: placed, fleet, execFails })
    const waiting = threads === 0 && cp.want > 0 && cp.placeable > 0 && !execFails.length
    const prevWait = prevRec?.lastAugReset === info.lastAugReset && prevRec?.charger?.waiting ? prevRec.charger.waitingSince : null
    rec.charger = { script: CHARGER, threads, want: cp.want, placeable: cp.placeable, can: cp.can, short: Math.max(0, cp.want - threads), gb: threads * STANEK.ramPerThread, wantGb: cp.want * STANEK.ramPerThread, H: placed.hosts.reduce((m, h) => Math.max(m, h.now * coreBonus(h.cores)), 0), Htarget: cp.Htarget, fleetGB: cp.fleetGB, hosts, waiting, waitingSince: waiting ? prevWait ?? new Date().toISOString() : null, execFails, roots: roots.length, why }
    const bad = !placedOk ? `layout not placed (${placeFails.length} placement(s) refused)` : cp.want > 0 && threads <= 0 && !waiting ? `charger not running anywhere in the fleet: ${why}` : rec.progress.flat ? `charge.js held ${rec.progress.chargerWas} threads and the gift's charge did not grow in ${rec.progress.minutes} min` : null
    publish({ phase: 'done', health: bad ? 'fail' : threads < cp.want ? 'warn' : 'ok', why: bad ?? (threads < cp.want ? `charger short: ${threads}/${cp.want} threads — ${why}` : `accepted; ${active.length} fragments placed; charger ${threads} threads on ${launched.map((l) => `${l.host}:${l.threads}`).join(' ')}`) })
  } catch (e) {
    publish({ health: 'error', why: `threw in ${rec.phase}: ${String(e).slice(0, 200)}` })
  }
}
