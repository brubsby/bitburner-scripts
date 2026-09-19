// The Singularity executor: one priced call at a time.
//
//   run act.js
//
// TWO SOURCES OF WORK, one executor.
//
// 1. ORDERS from progress.js (/tel/orders.txt). The planner makes no
//    Singularity ACT calls of its own any more — every join, work, crime,
//    gym, travel, company desk, course, focus, TOR/program purchase,
//    donation, augmentation purchase and install it decides is an order,
//    and this file performs it with the matching single-call actor. That
//    is what lets the planner run on its READS alone (~640GB at SF4.1
//    instead of 1,305GB): the expensive names live in the actors, 32-100GB
//    each, and only one is resident at a time.
//
//    A batch is executed in order. A failed donation or purchase stops the
//    rest of that purchase chain (the plan was priced as a sequence). The
//    install order runs only if something is queued — purchases that just
//    succeeded or augmentations already waiting — and is preceded by the
//    spend-down (homeup.js --reserve 0), because money does not survive a
//    prestige and home RAM does. Each batch is executed once, keyed by its
//    stamp; a batch from another life is ignored.
//
// 2. The BOOTSTRAP (actplan.js), for the hours before the planner can run
//    at all: crime for karma and money, gym, the Slum Snakes join, faction
//    work. It idles whenever the planner has produced a fresh pass.
//
// Everything it does is published to /tel/act.txt with the reason.

import { decide } from 'actplan.js'
import { bitNodeMults } from 'bitNodeMultipliers.js'
import { canUseSingularity, canUseGang } from 'sfgate.js'
import { SNAPSHOTS, SNAPSHOT_ORDER, readSnapshot } from 'snapshot.js'

const STATUS = '/tel/act.txt'
const RESULT = '/tel/act-result.txt'
const ORDERS = '/tel/orders.txt'
const ORDERS_FRESH_MS = 15 * 60 * 1000
const ACTORS = {
  join: 'act-join.js',
  work: 'act-work.js',
  crime: 'act-crime.js',
  gym: 'act-gym.js',
  travel: 'act-travel.js',
  company: 'act-company.js',
  course: 'act-course.js',
  focus: 'act-focus.js',
  tor: 'act-buyprogram.js',
  program: 'act-buyprogram.js',
  donate: 'act-donate.js',
  buyaug: 'act-buyaug.js',
  install: 'act-install.js',
}
/** Dynamic snapshots older than this are re-taken before the planner's next pass. */
const SNAPSHOT_REFRESH_MS = 60 * 1000

/**
 * Keep the planner's snapshot files current: static families once per
 * BitNode, dynamic ones every minute and immediately after an order batch.
 * One actor at a time, in dependency order (the price/stats/prereq readers
 * enumerate from the catalogue file). Returns what ran and what could not.
 */
async function refreshSnapshots(ns, info, { force = false } = {}) {
  const ran = []
  const failed = []
  for (const key of SNAPSHOT_ORDER) {
    const spec = SNAPSHOTS[key]
    fetchFromHome(ns, spec.file)
    const r = readSnapshot(ns, key, info)
    const age = r.at ? Date.now() - Date.parse(r.at) : Infinity
    const stale = !r.data || (spec.dynamic && (force || age > SNAPSHOT_REFRESH_MS))
    if (!stale) continue
    const out = await runSnapshot(ns, spec.actor)
    if (out.ran) ran.push(key)
    else failed.push(`${key}: ${out.why}`)
  }
  return { ran, failed }
}

async function runSnapshot(ns, actor) {
  const price = ns.getScriptRam(actor, 'home')
  const hosts = rootedHosts(ns)
    .map((h) => ({ h, free: ns.getServerMaxRam(h) - ns.getServerUsedRam(h) }))
    .filter((x) => x.free >= price)
    .sort((a, b) => b.free - a.free)
  if (!hosts.length) return { ran: false, why: `no rooted host has ${price}GB free` }
  const host = hosts[0].h
  if (host !== 'home') ns.scp([actor, 'factions.js', 'companyplan.js', 'installgate.js'], host, 'home')
  const pid = ns.exec(actor, host, 1)
  if (!pid) return { ran: false, why: `exec refused on ${host}` }
  const until = Date.now() + 15000
  while (ns.isRunning(pid) && Date.now() < until) await ns.sleep(200)
  return { ran: true, host }
}

/** Orders whose failure ends the purchase chain they belong to. */
const CHAIN = new Set(['donate', 'buyaug'])

function rootedHosts(ns) {
  const seen = new Set(['home'])
  const q = ['home']
  while (q.length) {
    const h = q.shift()
    for (const n of ns.scan(h)) if (!seen.has(n)) { seen.add(n); q.push(n) }
  }
  return [...seen].filter((h) => ns.hasRootAccess(h))
}

function readJson(ns, file) {
  try {
    return JSON.parse(ns.read(file) || 'null')
  } catch {
    return null
  }
}

function fetchFromHome(ns, file) {
  if (ns.getHostname() === 'home') return
  try {
    ns.scp(file, ns.getHostname(), 'home')
  } catch {
    /* previous copy stays */
  }
}

/** Run one actor somewhere with room; return `{ran, host, result, why}`. */
async function runActor(ns, kind, args) {
  const actor = ACTORS[kind]
  if (!actor) return { ran: false, why: `no actor for ${kind}` }
  const actorArgs = kind === 'tor' ? ['tor'] : kind === 'program' ? ['program', ...args] : args
  const price = ns.getScriptRam(actor, 'home')
  const hosts = rootedHosts(ns)
    .map((h) => ({ h, free: ns.getServerMaxRam(h) - ns.getServerUsedRam(h) }))
    .filter((x) => x.free >= price)
    .sort((a, b) => b.free - a.free)
  if (!hosts.length) return { ran: false, why: `no rooted host has ${price}GB free for ${actor}` }
  const host = hosts[0].h
  if (host !== 'home') ns.scp(actor, host, 'home')
  const pid = ns.exec(actor, host, 1, ...actorArgs)
  if (!pid) return { ran: false, why: `exec of ${actor} refused on ${host}` }
  // Wait for the actor to exit (a call is milliseconds; the install never returns).
  const until = Date.now() + 8000
  while (ns.isRunning(pid) && Date.now() < until) await ns.sleep(200)
  fetchFromHome(ns, RESULT)
  const r = readJson(ns, RESULT)
  const fresh = r && Date.now() - Date.parse(r.at) < 60e3 && r.actor === kind
  return { ran: true, host, pid, result: fresh ? r : null, ok: fresh ? r.ok === true : null }
}

/** homeup.js --reserve 0 on home, bounded: the remainder is spent or forfeit, never a blocked install. */
async function spendDown(ns) {
  try {
    const pid = ns.exec('homeup.js', 'home', 1, '--reserve', 0)
    if (!pid) return 'could not start homeup.js — installing anyway, the remainder is forfeit'
    const until = Date.now() + 30000
    while (ns.isRunning(pid) && Date.now() < until) await ns.sleep(500)
    return ns.isRunning(pid) ? 'spend-down did not finish within 30s — installing anyway' : 'spent the remainder on home RAM/cores before installing'
  } catch (e) {
    return `spend-down failed (${String(e).slice(0, 60)}) — installing anyway`
  }
}

export async function main(ns) {
  ns.disableLog('ALL')
  const info = ns.getResetInfo()
  const here = ns.getHostname()
  const publish = (o) => {
    ns.write(STATUS, JSON.stringify({ at: new Date().toISOString(), lastAugReset: info.lastAugReset, host: here, ...o }, null, 2), 'w')
    if (here !== 'home') ns.scp(STATUS, 'home', here)
  }
  ns.atExit(() => publish({ health: 'stopped', detail: 'act.js exited' }))
  if (!canUseSingularity(info)) {
    publish({ health: 'waiting', why: 'no Singularity access in this save; nothing here can act' })
    return
  }
  const node = bitNodeMults(info.currentNode)
  const tried = {}
  let work = null
  let last = null
  let lastOrdersAt = null
  let ordersReport = null
  const log = []

  while (true) {
    try {
      const player = ns.getPlayer()
      for (const f of ['/tel/progress.txt', '/tel/factionplan.txt', ORDERS]) fetchFromHome(ns, f)
      const snaps = await refreshSnapshots(ns, info)

      // ---- 1. orders from the planner --------------------------------------
      const batch = readJson(ns, ORDERS)
      const batchFresh = batch && batch.lastAugReset === info.lastAugReset && Date.now() - Date.parse(batch.at) < ORDERS_FRESH_MS
      if (batchFresh && batch.at !== lastOrdersAt && Array.isArray(batch.orders)) {
        lastOrdersAt = batch.at
        const results = []
        let chainFailed = false
        let bought = 0
        for (const o of batch.orders) {
          if (CHAIN.has(o.kind) && chainFailed) {
            results.push({ id: o.id, kind: o.kind, skipped: 'an earlier purchase in the chain failed' })
            continue
          }
          if (o.kind === 'install') {
            const queued = (o.requireQueued ?? 0) + bought
            if (!(queued > 0)) {
              results.push({ id: o.id, kind: o.kind, skipped: 'nothing queued to install' })
              continue
            }
            const sd = await spendDown(ns)
            const r = await runActor(ns, 'install', o.args)
            results.push({ id: o.id, kind: o.kind, ...r, spendDown: sd })
            break // the game reloads on success; nothing after this runs
          }
          const r = await runActor(ns, o.kind, o.args)
          results.push({ id: o.id, kind: o.kind, args: o.args, why: o.why, ...r })
          if (CHAIN.has(o.kind) && r.ok !== true) chainFailed = true
          if (o.kind === 'buyaug' && r.ok === true) bought++
          if (r.ok === true) {
            if (o.kind === 'work') work = { kind: 'work', faction: o.args[0], type: r.result?.type ?? o.args[1], since: r.result.at }
            else if (o.kind === 'crime') work = { kind: 'crime', type: o.args[0], since: r.result.at }
            else if (o.kind === 'gym') work = { kind: 'gym', gym: o.args[0], cls: o.args[1], since: r.result.at }
            else if (o.kind === 'company' || o.kind === 'course') work = { kind: o.kind, since: r.result.at }
          }
          if (o.kind === 'join') tried[o.args[0]] = Date.now()
        }
        ordersReport = { at: batch.at, count: batch.orders.length, results }
        // The reads the orders just changed — owned, catalogue, reputation, invitations.
        const after = await refreshSnapshots(ns, info, { force: true })
        publish({ health: 'ok', orders: ordersReport, snapshots: after, decision: { kind: 'idle', why: 'executed the planner\'s orders' }, work, last, log: log.slice(-8), tried })
        await ns.sleep(5000)
        continue
      }

      // ---- 2. the bootstrap ----------------------------------------------
      const state = {
        now: Date.now(),
        gangNode: canUseGang(info),
        factions: player.factions ?? [],
        player,
        node: node ? { CrimeSuccessRate: node.CrimeSuccessRate, CrimeMoney: node.CrimeMoney, CrimeExpGain: node.CrimeExpGain } : null,
        progress: readJson(ns, '/tel/progress.txt'),
        // A schedule from another life (or another BitNode) is not a schedule.
        schedule: (() => {
          const s = readJson(ns, '/tel/factionplan.txt')
          return s && s.lastAugReset === info.lastAugReset ? s : null
        })(),
        work,
        tried,
        gangFaction: ns.gang.inGang() ? readJson(ns, '/tel/gang.txt')?.faction ?? null : null,
      }
      const d = decide(state)
      let outcome = null
      if (d.kind !== 'idle') {
        const r = await runActor(ns, d.kind, d.args)
        outcome = r
        if (d.kind === 'join') tried[d.args[0]] = Date.now()
        if (r.ok === true) {
          if (d.kind === 'work') work = { kind: 'work', faction: d.args[0], type: r.result?.type ?? d.args[1], since: r.result.at }
          else if (d.kind === 'crime') work = { kind: 'crime', type: d.args[0], since: r.result.at }
          else if (d.kind === 'gym') work = { kind: 'gym', stat: d.stat, since: r.result.at }
          else if (d.kind === 'join') work = null
        }
        last = { at: new Date().toISOString(), decision: d, outcome }
        log.push(last)
        while (log.length > 20) log.shift()
      }
      publish({ health: 'ok', decision: d, work, last, orders: ordersReport, snapshots: snaps, log: log.slice(-8), tried })
      await ns.sleep(d.kind === 'idle' ? 30000 : 5000)
    } catch (err) {
      ns.print(`act error: ${err}`)
      publish({ health: 'error', detail: String(err).slice(0, 200) })
      await ns.sleep(15000)
    }
  }
}
