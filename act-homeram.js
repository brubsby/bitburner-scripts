// ONE Singularity call, then exit: ns.singularity.upgradeHomeRam() or
// upgradeHomeCores() (48GB each at SF4.1). Works from any city — the UI
// route homeup.js drives needs the player in Sector-12, which is why the
// pre-install spend-down once forfeited $2.95b from Chongqing.
/** @param {NS} ns */
export async function main(ns) {
  const [kind = 'RAM'] = ns.args
  let ok = false, error = null
  try { ok = String(kind).toLowerCase() === 'cores' ? ns.singularity.upgradeHomeCores() : ns.singularity.upgradeHomeRam() } catch (e) { error = String(e).slice(0, 120) }
  ns.write('/tel/act-result.txt', JSON.stringify({ at: new Date().toISOString(), actor: 'homeram', args: ns.args, ok, error }), 'w')
  if (ns.getHostname() !== 'home') ns.scp('/tel/act-result.txt', 'home', ns.getHostname())
}
