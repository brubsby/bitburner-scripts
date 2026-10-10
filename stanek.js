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
// THE CHARGER: charge.js on home with f x home RAM (f = the plan's decision of
// this life, /tel/plan.txt decisions.stanek — priced by the exit in progress.js;
// DEFAULT_F, said so, until one exists), within what home has free beyond
// progress.js's block. Relaunched when the roots or the thread count change by
// more than 10%. batch.js keeps the shortfall free on home (stanekHoldGb).
//
// Publishes /tel/stanek.txt on every exit path (atExit): gift state, accept
// outcome, layout, fragments with their charge, charger, allocation, health.
import { giftStateOf, layoutForGrid, sameLayout, chargeRootsOf, planAllocOf, DEFAULT_F, chargerThreadsOf, progressBlockGb, STANEK_FILE, STANEK, TYPE, TYPE_NAME } from 'stanekplan.js'
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
    // What is actually placed is what can be charged (a failed placement is published, not charged).
    const roots = chargeRootsOf(active.filter((f) => f.type !== TYPE.Booster).map((f) => ({ id: f.id, x: f.x, y: f.y, rot: f.rotation })))
    const plan = planAllocOf(ns.read('/tel/plan.txt'), info.lastAugReset)
    const f = plan ? plan.f : DEFAULT_F
    rec.alloc = { f, source: plan ? `the plan (${plan.at}, decisions.stanek)` : `DEFAULT_F ${DEFAULT_F}: no priced decision of this life in /tel/plan.txt decisions.stanek`, why: plan?.why ?? null }
    const homeMax = ns.getServerMaxRam('home')
    const homeUsed = ns.getServerUsedRam('home')
    const cores = ns.getServer('home').cpuCores
    const procs = ns.ps('home').filter((p) => p.filename === CHARGER)
    const running = procs.reduce((s, p) => s + p.threads, 0)
    const reserveGb = progressBlockGb(singularityRamMultiplier(info))
    const t = chargerThreadsOf({ f, homeMax, homeUsed, reserveGb, runningGb: running * STANEK.ramPerThread })
    const rootsArg = JSON.stringify(roots)
    const sameArgs = procs.length === 1 && procs[0].args[0] === rootsArg && procs[0].args[1] === info.lastAugReset
    const relaunch = !roots.length ? procs.length > 0 : !sameArgs || Math.abs(running - t.threads) > Math.max(1, 0.1 * t.threads)
    let threads = running
    let pid = procs[0]?.pid ?? 0
    let why = relaunch ? null : `running: ${running} threads (want ${t.want})`
    if (relaunch) {
      for (const p of procs) ns.kill(p.pid)
      threads = 0
      pid = 0
      if (roots.length && t.threads > 0) {
        pid = ns.exec(CHARGER, 'home', t.threads, rootsArg, info.lastAugReset)
        threads = pid > 0 ? t.threads : 0
        why = pid > 0 ? `launched ${t.threads} threads (want ${t.want})` : `ns.exec(${CHARGER}, home, ${t.threads}) returned 0`
      } else why = !roots.length ? 'no chargeable fragment placed' : t.want === 0 ? `f=${f}: no charging` : `no room on home: ${t.can} threads free beyond progress.js's ${reserveGb}GB block`
    }
    rec.charger = { script: CHARGER, pid, threads, want: t.want, can: t.can, short: Math.max(0, t.want - threads), gb: threads * STANEK.ramPerThread, wantGb: t.want * STANEK.ramPerThread, cores, homeMax, reserveGb, roots: roots.length, why }
    const bad = !placedOk ? `layout not placed (${placeFails.length} placement(s) refused)` : t.want > 0 && threads <= 0 ? `charger not running: ${why}` : null
    publish({ phase: 'done', health: bad ? 'fail' : threads < t.want ? 'warn' : 'ok', why: bad ?? (threads < t.want ? `charger short: ${threads}/${t.want} threads (batch.js frees the rest)` : `accepted; ${active.length} fragments placed; charger ${threads} threads`) })
  } catch (e) {
    publish({ health: 'error', why: `threw in ${rec.phase}: ${String(e).slice(0, 200)}` })
  }
}
