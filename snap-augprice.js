// Snapshot actor: ONE Singularity call family, written to a file for the planner
// (snapshot.js explains why). Runs anywhere; the result lands on home.
// Enumerates from the catalogue snapshot (0GB read) rather than calling
// getAugmentationsFromFaction itself, which would add 80GB to this file.
/** @param {NS} ns */
export async function main(ns) {
  const info = ns.getResetInfo()
  if (ns.getHostname() !== 'home') ns.scp('/tel/snap-catalog.txt', ns.getHostname(), 'home')
  const catalog = JSON.parse(ns.read('/tel/snap-catalog.txt') || 'null')
  const names = new Set()
  for (const list of Object.values(catalog?.data?.augs ?? {})) for (const n of list) names.add(n)
  const price = {}
  const repReq = {}
  for (const n of names) {
    price[n] = ns.singularity.getAugmentationPrice(n)
    repReq[n] = ns.singularity.getAugmentationRepReq(n)
  }
  ns.write('/tel/snap-augprice.txt', JSON.stringify({ at: new Date().toISOString(), lastAugReset: info.lastAugReset, lastNodeReset: info.lastNodeReset, data: { price, repReq } }), 'w')
  if (ns.getHostname() !== 'home') ns.scp('/tel/snap-augprice.txt', 'home', ns.getHostname())
}
