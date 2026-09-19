// ONE Singularity call, then exit: ns.singularity.setFocus(bool). 1.6GB at SF4.1.
/** @param {NS} ns */
export async function main(ns) {
  const [focus = true] = ns.args
  let ok = false, error = null
  try { ns.singularity.setFocus(focus !== false && focus !== 'false'); ok = true } catch (e) { error = String(e).slice(0, 120) }
  ns.write('/tel/act-result.txt', JSON.stringify({ at: new Date().toISOString(), actor: 'focus', args: ns.args, ok, error }), 'w')
  if (ns.getHostname() !== 'home') ns.scp('/tel/act-result.txt', 'home', ns.getHostname())
}
