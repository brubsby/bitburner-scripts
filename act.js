// The early-game Singularity dispatcher: one priced call at a time.
//
//   run act.js
//
// actplan.js decides; this file finds a rooted host with room for the ONE
// actor script the decision needs (act-join.js 48GB, act-work.js 48GB,
// act-crime.js 80GB, act-gym.js 32GB, act-travel.js 32GB at SF4.1 — each
// exits after its call), copies it there, runs it, reads the result back,
// and publishes /tel/act.txt. It idles the moment progress.js reports a live
// acting pass, so there is never a second planner fighting the first.
//
// Its own price is ~6GB: no Singularity identifier appears in this file or
// its imports (actplan.js, bodyplan.js and gangplan.js are pure), which is
// the whole point — the expensive names live in the actors.

import { decide } from 'actplan.js'
import { bitNodeMults } from 'bitNodeMultipliers.js'
import { canUseSingularity, canUseGang } from 'sfgate.js'

const STATUS = '/tel/act.txt'
const RESULT = '/tel/act-result.txt'
const ACTORS = { join: 'act-join.js', work: 'act-work.js', crime: 'act-crime.js', gym: 'act-gym.js', travel: 'act-travel.js' }

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
  const log = []

  while (true) {
    try {
      const player = ns.getPlayer()
      for (const f of ['/tel/progress.txt', '/tel/factionplan.txt']) fetchFromHome(ns, f)
      const state = {
        now: Date.now(),
        gangNode: canUseGang(info),
        factions: player.factions ?? [],
        player,
        node: node ? { CrimeSuccessRate: node.CrimeSuccessRate, CrimeMoney: node.CrimeMoney, CrimeExpGain: node.CrimeExpGain } : null,
        progress: readJson(ns, '/tel/progress.txt'),
        // A schedule from another life (or another BitNode) is not a schedule:
        // the BN5 file survived the flume into BN2 and named a faction we
        // are not in. Same stamp rule budget.js uses for claims.
        schedule: (() => {
          const s = readJson(ns, '/tel/factionplan.txt')
          return s && s.lastAugReset === info.lastAugReset ? s : null
        })(),
        work,
        tried,
      }
      const d = decide(state)
      let outcome = null
      if (d.kind !== 'idle') {
        const actor = ACTORS[d.kind]
        const price = ns.getScriptRam(actor, 'home')
        const hosts = rootedHosts(ns)
          .map((h) => ({ h, free: ns.getServerMaxRam(h) - ns.getServerUsedRam(h) }))
          .filter((x) => x.free >= price)
          .sort((a, b) => b.free - a.free)
        if (!hosts.length) {
          outcome = { ran: false, why: `no rooted host has ${price}GB free for ${actor}` }
        } else {
          const host = hosts[0].h
          if (host !== 'home') ns.scp(actor, host, 'home')
          const pid = ns.exec(actor, host, 1, ...d.args)
          if (!pid) outcome = { ran: false, why: `exec of ${actor} refused on ${host}` }
          else {
            await ns.sleep(3000)
            fetchFromHome(ns, RESULT)
            const r = readJson(ns, RESULT)
            const fresh = r && Date.now() - Date.parse(r.at) < 60e3 && r.actor === d.kind
            outcome = { ran: true, host, pid, result: fresh ? r : null }
            if (d.kind === 'join') tried[d.args[0]] = Date.now()
            if (fresh && r.ok) {
              if (d.kind === 'work') work = { kind: 'work', faction: d.args[0], type: d.args[1], since: r.at }
              else if (d.kind === 'crime') work = { kind: 'crime', type: d.args[0], since: r.at }
              else if (d.kind === 'gym') work = { kind: 'gym', stat: d.stat, since: r.at }
              else if (d.kind === 'join') work = null
            }
          }
        }
        last = { at: new Date().toISOString(), decision: d, outcome }
        log.push(last)
        while (log.length > 20) log.shift()
      }
      publish({ health: 'ok', decision: d, work, last, log: log.slice(-8), tried })
      await ns.sleep(d.kind === 'idle' ? 30000 : 5000)
    } catch (err) {
      ns.print(`act error: ${err}`)
      publish({ health: 'error', detail: String(err).slice(0, 200) })
      await ns.sleep(15000)
    }
  }
}
