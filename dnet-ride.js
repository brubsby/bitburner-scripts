// THE AIR-GAP RIDER (BitNode 15). Rows 8, 16 and 24 of the darknet are empty (Enums.ts AIR_GAP_DEPTH;
// darknetNetworkUtils.ts getAllOpenPositions never places a server on one), and connections only join
// adjacent rows (NetworkGenerator.ts addRandomConnections), so nothing at row 7 is ever connected to row 9.
// A crawl crosses only by RIDING a server that moves: a migration keeps the server's running scripts
// (NetworkMovement.ts moveDarknetServer disconnects and re-places it — no killServerScripts), so a crawler
// on a server that lands past the gap carries on from there.
//
//   run dnet-ride.js <neighbour>     (threads: as many as the host spares — the charge is linear in them)
//
// ns.dnet.induceServerMigration(neighbour) charges the neighbour by (cha + 500) / (difficulty x 200 + 1000)
// x 0.01 x threads per 6s call (effects.ts chargeServerMigration); at 1 it moves within [difficulty - 2,
// difficulty + 4] of ITS DIFFICULTY (not its row), off the gap rows, at random — so a neighbour whose
// difficulty reaches past the gap may land beyond it, and the crawler (dnet.js riderTargetOf) picks the one
// with a crawler on it and the most reach. Random mutations move servers the same way unasked
// (moveRandomDarknetServers, difficulty +-3); the rider makes it happen to a server that carries a crawler.
//
// Reports on DNET_PORT: ride {state: moved (its new row) | gone (offline / no longer connected) | failed}.
import { DNET_PORT } from 'dnetplan.js'

export async function main(ns) {
  ns.disableLog('ALL')
  const target = String(ns.args[0] ?? '')
  const me = ns.getHostname()
  let said = false
  const say = (o) => {
    said = true
    ns.writePort(DNET_PORT, JSON.stringify({ at: Date.now(), from: me, t: 'ride', host: target, threads: ns.self().threads, ...o }))
  }
  ns.atExit(() => {
    if (!said) say({ state: 'killed' })
  }, 'dnet-ride')
  const d0 = ns.dnet.getDepth(target)
  let calls = 0
  for (; calls < 5000; calls++) {
    const r = await ns.dnet.induceServerMigration(target)
    if (!r?.success) return say({ state: 'gone', from: d0, calls, why: `code ${r?.code}: ${String(r?.message ?? '').slice(0, 80)}` })
    // the call that fills the charge moves it (chargeServerMigration: newCharge 1 returned, the stored charge reset)
    if (r.progress >= 1 || ns.dnet.getDepth(target) !== d0) return say({ state: 'moved', from: d0, to: ns.dnet.getDepth(target), calls })
  }
  say({ state: 'failed', from: d0, calls, why: 'call cap' })
}
