// ONE Singularity call, then exit: ns.singularity.setFocus(bool). 1.6GB at SF4.1.
import { humanAtScreen } from 'human.js'
/** @param {NS} ns */
export async function main(ns) {
  const [focus = true] = ns.args
  let ok = false, error = null
  const want = focus !== false && focus !== 'false'
  // The order may be minutes old; the human may have sat down since.
  const seen = want ? humanAtScreen(ns) : null
  if (seen?.atScreen === true) error = `human at the window (${seen.why}) — left unfocused`
  else try { ns.singularity.setFocus(want); ok = true } catch (e) { error = String(e).slice(0, 120) }
  ns.write('/tel/act-result.txt', JSON.stringify({ at: new Date().toISOString(), actor: 'focus', args: ns.args, ok, error }), 'w')
  if (ns.getHostname() !== 'home') ns.scp('/tel/act-result.txt', 'home', ns.getHostname())
}
