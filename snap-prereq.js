// Snapshot actor: ONE Singularity call family, written to a file for the planner
// (snapshot.js explains why). Runs anywhere; the result lands on home.
/** @param {NS} ns */
export async function main(ns) {
  const info = ns.getResetInfo()
  if (ns.getHostname() !== 'home') ns.scp('/tel/snap-catalog.txt', ns.getHostname(), 'home')
  const catalog = JSON.parse(ns.read('/tel/snap-catalog.txt') || 'null')
  const names = new Set()
  for (const list of Object.values(catalog?.data?.augs ?? {})) for (const n of list) names.add(n)
  const prereq = {}
  for (const n of names) prereq[n] = ns.singularity.getAugmentationPrereq(n)
  ns.write('/tel/snap-prereq.txt', JSON.stringify({ at: new Date().toISOString(), lastAugReset: info.lastAugReset, lastNodeReset: info.lastNodeReset, data: { prereq } }), 'w')
  if (ns.getHostname() !== 'home') ns.scp('/tel/snap-prereq.txt', 'home', ns.getHostname())
}
