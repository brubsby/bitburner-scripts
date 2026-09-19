// ONE Singularity call, then exit: ns.singularity.purchaseAugmentation(faction, name). 80GB at SF4.1.
/** @param {NS} ns */
export async function main(ns) {
  const [faction, name] = ns.args
  let ok = false, error = null
  try { ok = ns.singularity.purchaseAugmentation(String(faction), String(name)) } catch (e) { error = String(e).slice(0, 120) }
  ns.write('/tel/act-result.txt', JSON.stringify({ at: new Date().toISOString(), actor: 'buyaug', args: ns.args, ok, error }), 'w')
  if (ns.getHostname() !== 'home') ns.scp('/tel/act-result.txt', 'home', ns.getHostname())
}
