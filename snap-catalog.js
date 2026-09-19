// Snapshot actor: ONE Singularity call family, written to a file for the planner
// (snapshot.js explains why). Runs anywhere; the result lands on home.
import { ALL_FACTIONS } from 'factions.js'
/** @param {NS} ns */
export async function main(ns) {
  const info = ns.getResetInfo()
  const augs = {}
  for (const f of ALL_FACTIONS) {
    try { augs[f] = ns.singularity.getAugmentationsFromFaction(f) } catch { /* not a faction in this node */ }
  }
  ns.write('/tel/snap-catalog.txt', JSON.stringify({ at: new Date().toISOString(), lastAugReset: info.lastAugReset, lastNodeReset: info.lastNodeReset, data: { augs } }), 'w')
  if (ns.getHostname() !== 'home') ns.scp('/tel/snap-catalog.txt', 'home', ns.getHostname())
}
