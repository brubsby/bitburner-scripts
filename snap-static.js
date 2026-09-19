// Snapshot actor: ONE Singularity call family, written to a file for the planner
// (snapshot.js explains why). Runs anywhere; the result lands on home.
// Enemies and invitation requirements are declarations that do not change
// within a BitNode, so this runs once per node.
import { ALL_FACTIONS } from 'factions.js'
/** @param {NS} ns */
export async function main(ns) {
  const info = ns.getResetInfo()
  const enemies = {}
  const reqs = {}
  for (const f of ALL_FACTIONS) {
    try { enemies[f] = ns.singularity.getFactionEnemies(f); reqs[f] = ns.singularity.getFactionInviteRequirements(f) } catch { /* not a faction here */ }
  }
  ns.write('/tel/snap-static.txt', JSON.stringify({ at: new Date().toISOString(), lastAugReset: info.lastAugReset, lastNodeReset: info.lastNodeReset, data: { enemies, reqs } }), 'w')
  if (ns.getHostname() !== 'home') ns.scp('/tel/snap-static.txt', 'home', ns.getHostname())
}
