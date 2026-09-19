// ONE step, then exit: apply for the field's best rung, then start the desk.
// applyToCompany + workForFaction-sized calls (48GB each at SF4.1).
/** @param {NS} ns */
export async function main(ns) {
  const [company, field = 'Software'] = ns.args
  let ok = false, position = null, error = null
  try {
    try { position = ns.singularity.applyToCompany(String(company), String(field)) } catch { /* no promotion available; the current job stands */ }
    ok = ns.singularity.workForCompany(String(company), true)
  } catch (e) { error = String(e).slice(0, 120) }
  ns.write('/tel/act-result.txt', JSON.stringify({ at: new Date().toISOString(), actor: 'company', args: ns.args, ok, position, error }), 'w')
  if (ns.getHostname() !== 'home') ns.scp('/tel/act-result.txt', 'home', ns.getHostname())
}
