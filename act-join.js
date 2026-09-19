// ONE Singularity call, then exit: ns.singularity.joinFaction(name).
// 48GB at SF4.1 — the price of joining, not of the whole planner (act.js
// explains the split). Result lands on home as /tel/act-result.txt.
/** @param {NS} ns */
export async function main(ns) {
  const [name] = ns.args
  let ok = false
  let error = null
  try {
    ok = ns.singularity.joinFaction(String(name))
  } catch (e) {
    error = String(e).slice(0, 120)
  }
  ns.write('/tel/act-result.txt', JSON.stringify({ at: new Date().toISOString(), actor: 'join', args: ns.args, ok, error }), 'w')
  if (ns.getHostname() !== 'home') ns.scp('/tel/act-result.txt', 'home', ns.getHostname())
}
