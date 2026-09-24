// ONE Singularity call, then exit: ns.singularity.universityCourse(uni, course, focus).
import { humanAtScreen, startFocused } from 'human.js'
/** @param {NS} ns */
export async function main(ns) {
  // While a human is at the window (human.js), keep the screen as it is: a
  // focused start takes it over, and an unfocused one while focused jumps to
  // the Terminal. upkeep.js focuses it once they go idle.
  const focus = startFocused(humanAtScreen(ns))
  const [uni, course] = ns.args
  let ok = false, error = null
  try { ok = ns.singularity.universityCourse(String(uni), String(course), focus) } catch (e) { error = String(e).slice(0, 120) }
  ns.write('/tel/act-result.txt', JSON.stringify({ at: new Date().toISOString(), actor: 'course', args: ns.args, ok, error }), 'w')
  if (ns.getHostname() !== 'home') ns.scp('/tel/act-result.txt', 'home', ns.getHostname())
}
