// ONE Singularity call, then exit: ns.singularity.commitCrime(type, focus).
// The game repeats the crime on its own until other work replaces it
// (Work/CrimeWork.ts:process loops), so a single call is a crime LOOP.
import { humanAtScreen, startFocused } from 'human.js'
/** @param {NS} ns */
export async function main(ns) {
  // While a human is at the window (human.js), keep the screen as it is: a
  // focused start takes it over, and an unfocused one while focused jumps to
  // the Terminal. upkeep.js focuses it once they go idle.
  const focus = startFocused(humanAtScreen(ns))
  const [type] = ns.args
  let ms = 0
  let error = null
  try {
    ms = ns.singularity.commitCrime(String(type), focus)
  } catch (e) {
    error = String(e).slice(0, 120)
  }
  ns.write('/tel/act-result.txt', JSON.stringify({ at: new Date().toISOString(), actor: 'crime', args: ns.args, ok: ms > 0, ms, error }), 'w')
  if (ns.getHostname() !== 'home') ns.scp('/tel/act-result.txt', 'home', ns.getHostname())
}
