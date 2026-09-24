// ONE step, then exit: apply for the field's best rung, then start the desk.
// applyToCompany + workForFaction-sized calls (48GB each at SF4.1).
import { humanAtScreen, startFocused } from 'human.js'
/** @param {NS} ns */
export async function main(ns) {
  // While a human is at the window (human.js), keep the screen as it is: a
  // focused start takes it over, and an unfocused one while focused jumps to
  // the Terminal. upkeep.js focuses it once they go idle.
  const focus = startFocused(humanAtScreen(ns))
  const [company, field = 'Software'] = ns.args
  let ok = false, position = null, error = null
  try {
    try { position = ns.singularity.applyToCompany(String(company), String(field)) } catch { /* no promotion available; the current job stands */ }
    ok = ns.singularity.workForCompany(String(company), focus)
  } catch (e) { error = String(e).slice(0, 120) }
  ns.write('/tel/act-result.txt', JSON.stringify({ at: new Date().toISOString(), actor: 'company', args: ns.args, ok, position, error }), 'w')
  if (ns.getHostname() !== 'home') ns.scp('/tel/act-result.txt', 'home', ns.getHostname())
}
