// THE STASIS LINK (BitNode 15): pins the host it runs on, so the labyrinth walker on it is not carried off.
//
//   run dnet-stasis.js        (one thread: setStasisLink costs 12GB, RamCostGenerator.ts dnet)
//
// WHY: a walk is one script (the lab position is per pid, labyrinth.ts getPositionInLab) and takes minutes
// at labs 4-5, while the network mutates every 150/depth cycles (darknetNetworkUtils.ts
// getDarknetCyclesPerMutation: ~1.3s at depth 23) — moving servers off the lab's row (the walker is then
// disconnected: 'lost') and restarting them (killServerScripts: 'killed'). A stasis-linked server is
// immutable (NetworkMovement.ts isImmutable: never moved, restarted or deleted). The limit is 1 + Wings +
// Hammer + Staff (effects.ts getStasisLinkLimit), so the crawler links only a lab-adjacent host that will
// run a walker. A link sets backdoorInstalled, and more than two backdoors add instability (3% timeouts each,
// offlineServerHandling.ts getTimeoutChance) — within the limit that is at most 2 more.
import { DNET_PORT } from 'dnetplan.js'

export async function main(ns) {
  ns.disableLog('ALL')
  const me = ns.getHostname()
  let said = false
  const say = (state, why) => {
    said = true
    ns.writePort(DNET_PORT, JSON.stringify({ at: Date.now(), from: me, t: 'stasis', host: me, state, why }))
  }
  ns.atExit(() => {
    if (!said) say('killed', 'the link was not set: the host restarted or moved during the 30s procedure')
  }, 'dnet-stasis')
  const r = await ns.dnet.setStasisLink(true)
  say(r?.success ? 'linked' : 'refused', r?.success ? null : `code ${r?.code}: ${String(r?.message ?? '').slice(0, 80)}`)
}
