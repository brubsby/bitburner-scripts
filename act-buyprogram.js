// ONE purchase, then exit: `tor` buys the router, `program <file>` a darkweb program.
/** @param {NS} ns */
export async function main(ns) {
  const [what, file] = ns.args
  let ok = false, error = null
  try { ok = what === 'tor' ? ns.singularity.purchaseTor() : ns.singularity.purchaseProgram(String(file)) } catch (e) { error = String(e).slice(0, 120) }
  ns.write('/tel/act-result.txt', JSON.stringify({ at: new Date().toISOString(), actor: what === 'tor' ? 'tor' : 'program', args: ns.args, ok, error }), 'w')
  if (ns.getHostname() !== 'home') ns.scp('/tel/act-result.txt', 'home', ns.getHostname())
}
