// THE LABYRINTH WALKER (BitNode 15). Started by a crawler (dnet.js) on a darknet server directly connected to
// the lab, with every thread the host can spare:
//
//   run dnet-lab.js <lab hostname>
//
// WHY A SCRIPT OF ITS OWN, WITH THREADS: a step is ns.dnet.authenticate(lab, 'north'...), and each one takes
// the authentication time of a server needing the lab's charisma (effects.ts calculateAuthenticationTime:
// 850 x (5 x 3000 + 1100) / (cha + 150) ~ 4.3s at lab 5), divided by 1 + 0.2(threads - 1). A walk is ~2
// steps per maze cell (dnetplan.labStep, depth first): lab 5's 60x40 maze is ~600 cells, ~2.4h on one
// thread, ~8 min on 100. The position is kept PER PID (labyrinth.ts getPositionInLab: labLocations[pid]),
// so the walk cannot be handed between scripts — one walker does the whole maze, and a killed walker starts
// over at the entrance (its successor has a new pid).
//
// ONE CALL PER STEP: the lab's authenticate reply carries the move's result (Darknet.ts:162-169 returns the
// lab's own message and data: "You have moved to x,y." / "You cannot go that way. You are still at x,y." and
// the 3x3 surroundings with '@' at the centre, labyrinth.ts getSurroundingsVisualized), so labreport is
// called once, at the entrance. At the end the reply is "You have successfully navigated the labyrinth!"
// and the lab is rooted with its reward cache on it (labyrinth.ts:337-352): this walker, holding the lab's
// session, copies the crawler there and runs it with --cache, which opens the cache and QUEUES the lab's
// augmentation (cacheFiles.ts getLabReward). The install that makes it count is the install gate's
// (installgate.js labInstallOf).
//
// FAILURE IS LOUD: every exit says why on DNET_PORT (dnet-seed.js -> /tel/dnet.txt `lab`): cleared,
// cha-short (the lab refuses below its charisma — the walk stops, the crawler retries later), lost (the
// lab is no longer connected: this host moved), exhausted (no unexplored branch: a bug in the walk), killed.
import { DNET_PORT, labStep, labViewOf } from 'dnetplan.js'

export async function main(ns) {
  ns.disableLog('ALL')
  const lab = String(ns.args[0] ?? '')
  const me = ns.getHostname()
  const t0 = Date.now()
  const st = { seen: null, stack: null }
  let steps = 0
  let said = false
  const say = (o) => {
    said = o.state !== 'progress'
    ns.writePort(DNET_PORT, JSON.stringify({ at: Date.now(), from: me, t: 'lab', host: lab, steps, threads: ns.self().threads, sec: Math.round((Date.now() - t0) / 1000), ...o }))
  }
  ns.atExit(() => {
    if (!said) say({ state: 'killed', why: 'the walker was killed (its host restarted, moved, or the crawler stopped it)' })
  }, 'dnet-lab')
  const rep = await ns.dnet.labreport()
  if (!rep?.success) return say({ state: 'lost', why: String(rep?.message ?? 'labreport failed').slice(0, 120) })
  let view = { coords: rep.coords, north: rep.north, east: rep.east, south: rep.south, west: rep.west }
  for (; steps < 20000; steps++) {
    const dir = labStep(st, view)
    if (dir === null) return say({ state: 'exhausted', coords: view.coords })
    const a = await ns.dnet.authenticate(lab, dir)
    if (a?.success) {
      // the reward cache sits on the lab: the crawler next pass sees the lab rooted and opens it there (dnet.js
      // walkLab: a cleared lab answers any direction with Success and a session, then scp + exec --cache) —
      // not this walker, whose every thread would pay scp + exec's 1.9GB
      return say({ state: 'cleared', coords: view.coords })
    }
    const msg = String(a?.message ?? '')
    if (/charism|moxie|charm/i.test(msg)) return say({ state: 'cha-short', why: msg.slice(0, 120) })
    if (a?.code === 408) {
      steps-- // timed out on instability: the same step again
      st.stack.pop()
      continue
    }
    const next = labViewOf(msg, a?.data)
    if (!next) return say({ state: 'lost', why: `code ${a?.code}: ${msg.slice(0, 120)}` })
    if (next.blocked) {
      // a wall where the view said open (should not happen): mark it and re-plan from the same cell
      st.stack.pop()
      view = { ...next, [dir]: false }
      continue
    }
    view = next
    if (steps % 100 === 0) say({ state: 'progress', coords: view.coords })
  }
  say({ state: 'step-cap', coords: view.coords })
}
