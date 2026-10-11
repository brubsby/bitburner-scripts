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
// THE LAYOUT: stanekplan.layoutForGrid (the optimiser's layout for the grid the
// game reports, tabled for BN13 at SF13 0..3). Placed only when the active set
// differs (an install keeps it; a node's end clears it), verified by re-reading.
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
import { giftStateOf, layoutForGrid, sameLayout, chargeRootsOf, planAllocOf, DEFAULT_F, chargerFleetOf, chargerPlanOf, chargerActionsOf, chargerWhyOf, chargeProgressOf, coreBonus, progressBlockGb, STANEK_FILE, CHARGE_FILE, STANEK, TYPE, TYPE_NAME } from 'stanekplan.js'
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
    let gift = giftStateOf(info, canAccessCotMG(info))
    rec.gift = gift
    if (!gift.available) return publish({ health: 'n/a', why: gift.why })
    // ---- 1. THE ACCEPT ---------------------------------------------------
    if (!gift.accepted && gift.want && !gift.forfeited) {
      rec.phase = 'accept'
      const returned = ns.stanek.acceptGift()
      info = ns.getResetInfo() // read back from the game, not from the call's return
      gift = giftStateOf(info, canAccessCotMG(info))
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
    const lay = layoutForGrid(width, height, nodePower)
    let active = ns.stanek.activeFragments()
    let placeFails = []
    if (!sameLayout(active, lay.placed)) {
      ns.stanek.clearGift()
      for (const p of lay.placed) if (!ns.stanek.placeFragment(p.x, p.y, p.rot, p.id)) placeFails.push(p)
      active = ns.stanek.activeFragments()
      rec.placedAt = new Date().toISOString()
    }
    const placedOk = sameLayout(active, lay.placed)
    rec.layout = { width, height, nodePower, key: lay.key, source: lay.source, placed: lay.placed, ok: placedOk, placeFails }
    rec.fragments = active.map((f) => ({ id: f.id, x: f.x, y: f.y, rot: f.rotation, type: TYPE_NAME[f.type] ?? f.type, highestCharge: f.highestCharge, numCharge: f.numCharge, effect: f.chargedEffect }))
    // ---- 3. THE CHARGER --------------------------------------------------
    rec.phase = 'charger'
    const prevRec = (() => {
      try {
        return JSON.parse(ns.read(STANEK_FILE) || 'null')
      } catch {
        return null
      }
    })()
    rec.progress = chargeProgressOf(prevRec, rec.fragments, info.lastAugReset)
    // What is actually placed is what can be charged (a failed placement is published, not charged).
    const roots = chargeRootsOf(active.filter((f) => f.type !== TYPE.Booster).map((f) => ({ id: f.id, x: f.x, y: f.y, rot: f.rotation })))
    const plan = planAllocOf(ns.read('/tel/plan.txt'), info.lastAugReset)
    const f = plan ? plan.f : DEFAULT_F
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
