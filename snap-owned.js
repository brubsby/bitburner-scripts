// Snapshot actor: ONE Singularity call family, written to a file for the planner
// (snapshot.js explains why). Runs anywhere; the result lands on home.
/** @param {NS} ns */
export async function main(ns) {
  const info = ns.getResetInfo()
  const data = { owned: ns.singularity.getOwnedAugmentations(false), purchased: ns.singularity.getOwnedAugmentations(true) }
  ns.write('/tel/snap-owned.txt', JSON.stringify({ at: new Date().toISOString(), lastAugReset: info.lastAugReset, lastNodeReset: info.lastNodeReset, data }), 'w')
  if (ns.getHostname() !== 'home') ns.scp('/tel/snap-owned.txt', 'home', ns.getHostname())
}
