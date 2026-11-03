// Snapshot actor: ONE Singularity call family, written to a file for the planner
// (snapshot.js explains why). Runs anywhere; the result lands on home.
/** @param {NS} ns */
export async function main(ns) {
  const info = ns.getResetInfo()
  if (ns.getHostname() !== 'home') ns.scp('/tel/snap-catalog.txt', ns.getHostname(), 'home')
  const catalog = JSON.parse(ns.read('/tel/snap-catalog.txt') || 'null')
  const names = new Set()
  for (const list of Object.values(catalog?.data?.augs ?? {})) for (const n of list) names.add(n)
  // OWNED AND QUEUED too, not only the faction catalogue: BN15's darknet lab rewards (The W1ngs of Icarus …)
  // are queued without belonging to any faction, and progress.js prices every pending aug — it threw on every
  // pass for ~24h of BN15.1 (2026-11-02, 'snapshot augstats.stats has no entry for The W1ngs of Icarus').
  // Read from snap-owned's file (its getOwnedAugmentations), not called here: that would double this actor's RAM.
  if (ns.getHostname() !== 'home') ns.scp('/tel/snap-owned.txt', ns.getHostname(), 'home')
  const owned = JSON.parse(ns.read('/tel/snap-owned.txt') || 'null')
  for (const n of [...(owned?.data?.owned ?? []), ...(owned?.data?.purchased ?? [])]) names.add(n)
  const stats = {}
  for (const n of names) stats[n] = ns.singularity.getAugmentationStats(n)
  ns.write('/tel/snap-augstats.txt', JSON.stringify({ at: new Date().toISOString(), lastAugReset: info.lastAugReset, lastNodeReset: info.lastNodeReset, data: { stats } }), 'w')
  if (ns.getHostname() !== 'home') ns.scp('/tel/snap-augstats.txt', 'home', ns.getHostname())
}
