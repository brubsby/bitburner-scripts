// ONE Singularity identifier, then exit: ns.singularity.joinFaction(name).
// 48GB at SF4.1 — the price of joining, not of the whole planner (act.js
// explains the split). Retries for a few seconds: an invitation that a
// travel order just made possible arrives on the game's next check, every
// ten cycles (engine.tsx:171-176), and joinFaction is false until then.
/** @param {NS} ns */
export async function main(ns) {
  const [name] = ns.args
  let ok = false
  let error = null
  const until = Date.now() + 6000
  try {
    for (;;) {
      ok = ns.singularity.joinFaction(String(name))
      if (ok || Date.now() > until) break
      await ns.sleep(500)
    }
  } catch (e) {
    error = String(e).slice(0, 120)
  }
  ns.write('/tel/act-result.txt', JSON.stringify({ at: new Date().toISOString(), actor: 'join', args: ns.args, ok, error }), 'w')
  if (ns.getHostname() !== 'home') ns.scp('/tel/act-result.txt', 'home', ns.getHostname())
}
