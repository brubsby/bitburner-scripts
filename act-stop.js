// ONE Singularity call, then exit: ns.singularity.stopAction(). Run by act.js's
// negative-cash escape (nodeecon.softlockStep level 1): a class or gym fee is
// charged every second with no balance check (Work/Formulas.ts calculateCost ->
// loseMoney), so a paid class with cash below zero drives the life further
// into a hole. The planner restarts the work once cash covers the fee floor.
/** @param {NS} ns */
export async function main(ns) {
  let ok = false
  let error = null
  try {
    ok = ns.singularity.stopAction() === true
    if (!ok) error = 'stopAction returned false (nothing was running)'
  } catch (e) {
    error = String(e).slice(0, 160)
  }
  ns.write('/tel/act-result.txt', JSON.stringify({ at: new Date().toISOString(), actor: 'stop', args: ns.args, ok, error }), 'w')
  if (ns.getHostname() !== 'home') ns.scp('/tel/act-result.txt', 'home', ns.getHostname())
}
