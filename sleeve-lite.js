// sleeve-lite.js — one shot (a watchdog JOB, placed anywhere): task the sleeves while sleeve.js
// (49.75GB) has no host. The decision is sleeveliteplan.liteStepOf (pure; priced in its header):
// IDLE at entry (the game's bonus-time bank, Sleeve.ts:264-276), the Bladeburner fleet the route would
// run at the join (progress.js routeFleet). Stands down once sleeve.js runs or has assigned this life.
//
// RAM: base 1.6 + getResetInfo 1.0 + sleeve.getNumSleeves 4 + sleeve.setToIdle 4 +
// sleeve.setToBladeburnerAction 4 + scp 0.6 + getHostname 0.05 = 15.25GB, for a second, at every
// Source-File level (the ns.sleeve surface is not SF4-scaled). sleeve.js: 49.75GB resident.
import { canUseSleeve } from 'sfgate.js'
import { liteStepOf } from 'sleeveliteplan.js'
import { reporter, describe } from 'status.js'

// The files it reads, pulled from home first (ns.read is local; invariant C10).
const RECORD = '/tel/sleeve-lite.txt'
const PLAN = '/tel/plan.txt'
const BLADE = '/tel/bladeburner.txt'
const SLEEVE = '/tel/sleeve.txt'
const RESERVE = '/tel/reserve-sleeve.txt'

function pull(ns, file) {
  try {
    if (ns.getHostname() !== 'home') ns.scp(file, ns.getHostname(), 'home')
  } catch {
    /* home unreachable: the local copy decides */
  }
}
const readJson = (ns, f) => {
  try {
    return JSON.parse(ns.read(f) || 'null')
  } catch {
    return null
  }
}

export async function main(ns) {
  const note = reporter(ns, RECORD)
  const mirror = () => {
    try {
      if (ns.getHostname() !== 'home') ns.scp(RECORD, 'home', ns.getHostname())
    } catch {
      /* the local copy stands */
    }
  }
  // Killed mid-run (an install, a kill): say so; the next run re-decides from the game's tasks.
  ns.atExit(() => {
    note.exit('stopped', { detail: 'sleeve-lite.js exited' })
    mirror()
  })
  const info = ns.getResetInfo()
  if (!canUseSleeve(info)) {
    note('waiting', { result: 'capability-absent', bitNode: info.currentNode, detail: 'no Sleeve API (Source-File 10): nothing to task' })
    return mirror()
  }
  for (const f of [RECORD, PLAN, BLADE, SLEEVE, RESERVE]) pull(ns, f)
  const rec = readJson(ns, RECORD)
  const n = ns.sleeve.getNumSleeves()
  const step = liteStepOf({ node: info.currentNode, lifeStart: info.lastAugReset, rec, plan: readJson(ns, PLAN), blade: readJson(ns, BLADE), sleeveTel: readJson(ns, SLEEVE), reserve: readJson(ns, RESERVE), n })
  const base = { bitNode: info.currentNode, lastAugReset: info.lastAugReset, n }
  if (!step.act) {
    // Nothing to do: the record keeps its key (what was set, and when).
    note('ok', { ...base, result: 'held', key: rec?.bitNode === info.currentNode && rec?.lastAugReset === info.lastAugReset ? rec.key ?? null : null, setAt: rec?.setAt ?? null, detail: step.why })
    return mirror()
  }
  const set = []
  let refused = 0
  try {
    for (let i = 0; i < n; i++) {
      const task = step.act === 'fleet' ? step.tasks?.[i] : null
      const ok = task?.kind === 'bladeburner' ? ns.sleeve.setToBladeburnerAction(i, task.action) : ns.sleeve.setToIdle(i)
      if (!ok && task?.kind === 'bladeburner') refused++
      set.push(task?.kind === 'bladeburner' ? task.action : 'idle')
    }
  } catch (e) {
    note('error', { ...base, result: 'error', key: null, set, detail: describe(e) })
    mirror()
    throw e
  }
  // A refused action is not set: the next run tries again (the key is only kept when every call held).
  note(refused ? 'degraded' : 'ok', { ...base, result: step.act, key: refused ? null : step.key, setAt: new Date().toISOString(), set, refused, detail: step.why })
  mirror()
}
