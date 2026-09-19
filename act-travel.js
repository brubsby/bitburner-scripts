// ONE Singularity call, then exit: ns.singularity.travelToCity(city). $200k, instant.
/** @param {NS} ns */
export async function main(ns) {
  const [city] = ns.args
  let ok = false
  let error = null
  try {
    ok = ns.singularity.travelToCity(String(city))
  } catch (e) {
    error = String(e).slice(0, 120)
  }
  ns.write('/tel/act-result.txt', JSON.stringify({ at: new Date().toISOString(), actor: 'travel', args: ns.args, ok, error }), 'w')
  if (ns.getHostname() !== 'home') ns.scp('/tel/act-result.txt', 'home', ns.getHostname())
}
